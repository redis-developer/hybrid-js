import { Score, Fusion } from './models/Fusion.js'
import { AggregateSteps, createClient, RedisClientType, SchemaFieldTypes, VectorAlgorithms } from 'redis';
import axios from 'axios';
import fs from 'node:fs';
import JSONStream from 'JSONStream';
import { Stream } from 'node:stream';
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const REDIS_URL = 'redis://localhost:12000';
const REDIS_IDX = 'idx';
const PASSAGES_FILE = `${process.env.PWD}/data/passages.jsonl`;
const QUERIES_FILE = `${process.env.PWD}/data/queries.jsonl`
const EMBEDDING_URL = 'http://localhost:8000/v1/embeddings';
const EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const EMBEDDING_DIM = 1024;

enum EmbeddingType {
    Query = 'query',
    Passage = 'passage'
};

type Relevance = {
    pid: string,
    relevance: number
};

type NdcgResultType = {
    qid: string,
    ndcg: number
};

enum QueryType {
    KNN,
    FTS,
    HYB
};

type QueryScores = {
    qid: string,
    results: {
        cos: Array<Score>,
        fts: Array<Score>
    }
}

type RankedScore = {
    id: string,
    score: number,
    rank: number
}

type SearchResult = {
    qid: string,
    scores: Array<RankedScore>
}

async function createIndex(client: RedisClientType) {
    try { await client.ft.dropIndex(REDIS_IDX); }
    catch {void 0};

    await client.ft.create(REDIS_IDX, { 
        '$.text': { 
            type: SchemaFieldTypes.TEXT, 
            AS: 'text' 
        },
        '$.vector': { 
            type: SchemaFieldTypes.VECTOR,
            AS: 'vector',
            ALGORITHM: VectorAlgorithms.FLAT,
            TYPE: 'FLOAT32',
            DIM: EMBEDDING_DIM,
            DISTANCE_METRIC: 'COSINE'
        }}, 
        { ON: 'JSON', PREFIX: 'passage:' });
}

async function getEmbedding(text:string, type: EmbeddingType) {
    const result = await axios.post(EMBEDDING_URL, {
            input: [text],
            model: EMBEDDING_MODEL,
            input_type: type
    });
    return result.data.data[0].embedding;
}

function ndcg(searchResults: Array<SearchResult>): Array<NdcgResultType> {
    const metrics: Array<NdcgResultType> = [];
    const calcDCG = (acc: number, elm:Relevance, index: number) => acc + (Math.pow(elm['relevance'], 2) - 1) / Math.log2(index + 2);
    
    searchResults.forEach((searchResult) => {
        const predicted: Array<Relevance> = [];
        searchResult['scores'].forEach((result) => {
            predicted.push({pid: result['id'], relevance:searchResult['scores'].length - result['rank'] + 1});
        });
        const groundTruth: Array<Relevance> = [...predicted].sort((a,b) => b.relevance - a.relevance);
        const dcg = predicted.reduce(calcDCG, 0);
        const idcg = groundTruth.reduce(calcDCG, 0);
        metrics.push({qid: searchResult['qid'], ndcg: parseFloat((dcg/idcg).toFixed(4))});
    });
    return metrics;
}

async function search(client: RedisClientType, queryType: QueryType): Promise<Array<QueryScores>> {    
    const queries = fs.createReadStream(QUERIES_FILE)
    .pipe(JSONStream.parse())
    .pipe(new Stream.PassThrough({objectMode: true}));
    
    const allResults = [];
    for await (const query of queries) {
        let qstr = '';
        const qobj: { [key:string]: string|number|boolean|Array<object>|object } = {    
            LOAD: [
                { identifier: '$.qid', AS: 'qid' },
                { identifier: '$.pid', AS: 'pid' },
                { identifier: '$.rank', AS: 'rank' },
            ],        
            SCORER: 'TFIDF',
            ADDSCORES: true,
            DIALECT: 4
        };
        let qvec;
        switch (queryType) {
            case QueryType.FTS:
                qstr = `@text:${query['q_str']}`;
                qobj['STEPS'] = [ 
                    { type: AggregateSteps.SORTBY, BY: {BY: '@__score', DIRECTION: 'DESC'}}
                ];
                break;
            case QueryType.KNN:
                qvec = await getEmbedding(query['query'], EmbeddingType.Query) 
                qstr = '*=>[KNN 10 @vector $qvec AS dist]'; 
                qobj['PARAMS'] = { qvec: Buffer.from(new Float32Array(qvec).buffer) };
                qobj['STEPS'] = [ 
                    { type: AggregateSteps.APPLY, expression: '(2 - @dist)/2', AS: 'cos_score'},
                    { type: AggregateSteps.SORTBY, BY: {BY: '@cos_score', DIRECTION: 'DESC'}}
                ];
                break;
            case QueryType.HYB:
                qvec = await getEmbedding(query['query'], EmbeddingType.Query); 
                qstr = `@text:${query['q_str']}=>[KNN 10 @vector $qvec AS dist]`;
                qobj['PARAMS'] = { qvec: Buffer.from(new Float32Array(qvec).buffer) };
                qobj['STEPS'] = [ 
                    { type: AggregateSteps.APPLY, expression: '(2 - @dist)/2', AS: 'cos_score'}
                ];
                break;
            default:
                console.error('invalid query type');
                process.exit(1);
        }

        const rows = await client.ft.aggregate(REDIS_IDX, qstr, qobj);
        const queryScores: QueryScores = {qid:query['qid'], results:{cos:[], fts:[]}};
        for (const row of rows.results) {
            assert(JSON.parse(row['qid'])[0] === query['qid']);
            switch (queryType) {
                case QueryType.FTS:
                    queryScores['results']['fts'].push(new Score(
                        JSON.parse(row['pid'])[0], 
                        parseFloat(row['__score']), 
                        JSON.parse(row['rank'])[0]
                    ));
                    break;
                case QueryType.KNN:
                    queryScores['results']['cos'].push(new Score(
                        JSON.parse(row['pid'])[0], 
                        parseFloat(row['cos_score']), 
                        JSON.parse(row['rank'])[0]
                    ));
                    break;
                case QueryType.HYB:  
                    queryScores['results']['fts'].push(new Score(
                        JSON.parse(row['pid'])[0], 
                        parseFloat(row['__score']), 
                        JSON.parse(row['rank'])[0]
                    ));
                    queryScores['results']['cos'].push(new Score(
                        JSON.parse(row['pid'])[0], 
                        parseFloat(row['cos_score']), 
                        JSON.parse(row['rank'])[0]
                    ));
                    break;
                default:
                    console.error('invalid query type');
                    process.exit(1);
            }
        }
        allResults.push(queryScores);
    }
    return allResults;
}

async function loadRedis(client: RedisClientType) {
    const passagesStr = fs.createReadStream(PASSAGES_FILE)
        .pipe(JSONStream.parse())
        .pipe(new Stream.PassThrough({objectMode: true}))

    await createIndex(client);
    for await (const doc of passagesStr) {
        doc['vector'] = await getEmbedding(doc['text'], EmbeddingType.Passage);
        await client.json.set(`passage:${doc['pid']}`, '$', doc);
    }
}

function formatFused(inArr: Array<string>, orig: Array<RankedScore>): Array<RankedScore> {
    const outArr: Array<RankedScore> = [];

    for (let i=0, j=inArr.length; i < inArr.length; i++, j--) {
        const match: RankedScore | undefined = orig.find(elm => elm.id == inArr[i]);
        if (match) {
            outArr[i] = {id: inArr[i], score: j, rank: match['rank']}
        }
    }
    return outArr;
}

(async () => {
    const client: RedisClientType = createClient({url: REDIS_URL});
    client.on('error', (err) => {
        console.error(err.message);
    });  
    await client.connect();
    await loadRedis(client);

    const mean = (acc: number, cur: NdcgResultType, _: number, arr: Array<NdcgResultType>) => acc + cur.ndcg/arr.length;
    
    const knn = await search(client, QueryType.KNN);
    const knnScores: Array<SearchResult> = knn.map((elm) => ({'qid': elm.qid, 'scores': elm.results.cos}));
    console.log(`KNN NDCG Mean: ${ndcg(knnScores).reduce(mean,0).toFixed(4)}`);
    
    //const fts = await search(client, QueryType.FTS);
    //const ftsScores: Array<SearchResult> = fts.map((elm) => ({'qid': elm.qid, 'scores': elm.results.fts}));
    //console.log(`FTS NDCG Mean: ${ndcg(ftsScores).reduce(mean,0).toFixed(4)}`);
    
    const hyb = await search(client, QueryType.HYB);
    const bordaScores: Array<SearchResult> = [];
    const rrfScores: Array<SearchResult> = [];
    const rsfScores: Array<SearchResult> = [];
    const dbsfScores: Array<SearchResult> = [];
    hyb.forEach((resObj) => {
        const cos = resObj['results']['cos'];
        const fts = resObj['results']['fts'];
        const fusion = new Fusion([cos, fts]);
        bordaScores.push({qid: resObj['qid'], scores: formatFused(fusion.borda(), cos)});
        rrfScores.push({qid: resObj['qid'], scores: formatFused(fusion.rrf(), cos)});
        rsfScores.push({qid: resObj['qid'], scores: formatFused(fusion.rsf(), cos)});
        dbsfScores.push({qid: resObj['qid'], scores: formatFused(fusion.dbsf(), cos)});

    });
    console.log(`Borda NDCG Mean: ${ndcg(bordaScores).reduce(mean,0).toFixed(4)}`);
    console.log(`RRF NDCG Mean: ${ndcg(rrfScores).reduce(mean,0).toFixed(4)}`);
    console.log(`RSF NDCG Mean: ${ndcg(rsfScores).reduce(mean,0).toFixed(4)}`);
    console.log(`DBSF NDCG Mean: ${ndcg(dbsfScores).reduce(mean,0).toFixed(4)}`);

    await client.disconnect();
})();