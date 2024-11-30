import { Score, Fusion } from './models/Fusion.js';
import { EmbeddingType, QueryType, NdcgResultType, QueryScores, 
         RankedScore, Relevance, SearchResult } from './types.js';
import { AggregateSteps, createClient, RedisClientType, SchemaFieldTypes, VectorAlgorithms } from 'redis';
import axios from 'axios';
import fs from 'node:fs';
import JSONStream from 'JSONStream';
import { Stream } from 'node:stream';
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const EMBEDDING_URL = 'http://localhost:8000/v1/embeddings';
const EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const EMBEDDING_DIM = 1024;
const EMBEDDING_TYPE = 'FLOAT32';
const PASSAGES_FILE = `${process.env.PWD}/data/passages.jsonl`;
const QUERIES_FILE = `${process.env.PWD}/data/queries.jsonl`
const REDIS_URL = 'redis://localhost:12000';
const REDIS_IDX = 'idx';

/**
 * Creates a Redis index with a schema that includes a text and vector field.
 * 
 * @async
 * @function
 * @param { RedisClientType } client 
 */
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
            TYPE: EMBEDDING_TYPE,
            DIM: EMBEDDING_DIM,
            DISTANCE_METRIC: 'COSINE'
        }}, 
        { ON: 'JSON', PREFIX: 'passage:' });
};

/**
 * Reformats a ranked fusion array (array of IDs) into an array of objects that include the ID and its
 * original MS Marco relevance rank.
 * 
 * @function
 * @param { Array<string> } inArr sorted array of IDs returned from fusion function
 * @param { Array<RankedScore> } orig array IDs and their corresponding MS Marco relevance ranks
 * @returns { Array<RankedScore> }
 */
function formatFused(inArr: Array<string>, orig: Array<RankedScore>): Array<RankedScore> {
    const outArr: Array<RankedScore> = [];

    for (let i=0, j=inArr.length; i < inArr.length; i++, j--) {
        const match: RankedScore | undefined = orig.find(elm => elm.id == inArr[i]);
        if (match) {
            outArr[i] = {id: inArr[i], score: j, rank: match['rank']}
        }
    }
    return outArr;
};

/**
 * Performs a REST API call to a Nvidia NIM embedding service.
 * 
 * @async
 * @function
 * @param {string} text passage or query to be vectorized
 * @param { EmbeddingType } type type of vector to be created (query or passage)
 * @returns { Promise<Array<number>> }
 */
async function getEmbedding(text:string, type: EmbeddingType): Promise<Array<number>> {
    const result = await axios.post(EMBEDDING_URL, {
            input: [text],
            model: EMBEDDING_MODEL,
            input_type: type
    });
    return result.data.data[0].embedding;
};

/**
 * Helper function for creating the Redis vector index and loading the MS Marco passages from file to
 * Redis JSON documents.
 * 
 * @async
 * @function
 * @param { RedisClientType } client 
 */
async function loadRedis(client: RedisClientType) {
    const passagesStr = fs.createReadStream(PASSAGES_FILE)
        .pipe(JSONStream.parse())
        .pipe(new Stream.PassThrough({objectMode: true}))

    await createIndex(client);
    for await (const doc of passagesStr) {
        doc['vector'] = await getEmbedding(doc['text'], EmbeddingType.Passage);
        await client.json.set(`passage:${doc['pid']}`, '$', doc);
    }
};

/**
 * Implements the Normalized Discount Cumulative Gain algorithm.  The input is an array of SearchResults.
 * Each SearchResult is a query ID and a sorted array of RankedScores.  A RankedScore is a passage ID,
 * it's score yielded from a fusion algorithm, and its original MS Marco relevance rank.
 * 
 * The function measures how closely the generated ranks are to the original MS Marco ranks.
 * 
 * @function
 * @param { Array<SearchResult> } searchResults results from fusion algorithm
 * @returns { Array<NdcgResultType> } array of NDCG calculations, one per query ID
 */
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

/**
 * Implements a Redis FT.AGGREGATION query.  The function is parameterized to allow for full-text, KNN,
 * or hybrid queries.  The node-redis query structure is built according to the query type.  The return
 * value is an array of QueryScores objects.  Each QueryScore object is a query ID along with the Redis
 * search result which could be full-text score, vector distance score or both in the case of a hybrid
 * query.
 * 
 * @async
 * @function
 * @param { RedisClientType } client 
 * @param { QueryType } queryType 
 * @returns { Promise<Array<QueryScores>> }
 */
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

/**
 * Main routine. Perform the rank fusion algorithms on all queries and associated MS Marco passages then calculates
 * a NDCG average agains the Marco relevances across queries for each fusion type.
 */
(async () => {
    const client: RedisClientType = createClient({url: REDIS_URL});
    client.on('error', (err) => {
        console.error(err.message);
    });  
    await client.connect();
    await loadRedis(client);

    const mean = (acc: number, cur: NdcgResultType, _: number, arr: Array<NdcgResultType>) => acc + cur.ndcg/arr.length;
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
    console.log(`RRF NDCG Mean:   ${ndcg(rrfScores).reduce(mean,0).toFixed(4)}`);
    console.log(`RSF NDCG Mean:   ${ndcg(rsfScores).reduce(mean,0).toFixed(4)}`);
    console.log(`DBSF NDCG Mean:  ${ndcg(dbsfScores).reduce(mean,0).toFixed(4)}`);

    /*
    const knn = await search(client, QueryType.KNN);
    const knnScores: Array<SearchResult> = knn.map((elm) => ({'qid': elm.qid, 'scores': elm.results.cos}));
    console.log(`KNN NDCG Mean: ${ndcg(knnScores).reduce(mean,0).toFixed(4)}`);
    
    const fts = await search(client, QueryType.FTS);
    const ftsScores: Array<SearchResult> = fts.map((elm) => ({'qid': elm.qid, 'scores': elm.results.fts}));
    console.log(`FTS NDCG Mean: ${ndcg(ftsScores).reduce(mean,0).toFixed(4)}`);
    */

    await client.disconnect();
})();