import fs from 'node:fs';
import { Stream } from 'node:stream';
import JSONStream from 'JSONStream';
import { parse } from 'csv-parse';
import { createGunzip } from 'node:zlib';
import process from 'node:process';

const marcoDir = `${process.env.PWD}/marco`;
const dataDir = `${process.env.PWD}/data`;
const passagesInDir = `${marcoDir}/msmarco_v2_passage`;
const queriesFile = `${dataDir}/queries.jsonl`;
const top100File = `${marcoDir}/passv2_dev2_top100.txt`;
const passagesOutFile = `${dataDir}/passages.jsonl`;

type queryType = {
    query: string, 
    pidObjs: Array<{[key:string]:number}>
};

type dataSetType = { 
    [key:string]: queryType
};

/**
 * Helper function for creating a small test set from the MS Marco TREC passage ranking dataset.
 * -  Uses a hand-built queries.jsonl file to determine which passages are of interest
 * -  Expects a 'marco' directory with following contents:
 *      - passv2_dev2_top100.txt file
 *      - msmarco_v2_passage directory with all the passage subdirectories and file
 * - Output is written to passages.jsonl in the data directory.
 */
async function load() {
    const queryInStream = fs.createReadStream(queriesFile)
    .pipe(JSONStream.parse())
    .pipe(new Stream.PassThrough({objectMode: true}));

    const queries: {[key: string]: string} = {};
    for await (const row of queryInStream) {
        queries[row['qid']] = row['query'];
    }

    const top100Stream = fs.createReadStream(top100File)
        .pipe(parse({delimiter: ' '}))
        .pipe(new Stream.PassThrough({objectMode: true}));

    const dataSet: dataSetType = {}
    for await (const row of top100Stream) {
        if (Object.prototype.hasOwnProperty.call(queries, row[0])) {
            const qid = row[0];
            if (!Object.prototype.hasOwnProperty.call(dataSet, qid)) {
                dataSet[qid] = {
                    query:queries[qid], 
                    pidObjs:[]
                };
            }
            if (dataSet[qid]['pidObjs'].length < 10) { 
                dataSet[qid]['pidObjs'].push({[row[2]]:parseInt(row[3])});
            }
        }
    }
   
    const passageOutStream = fs.createWriteStream(passagesOutFile, {flags: 'a'});
    for (const qid in dataSet) {
        for (const pidObj of dataSet[qid]['pidObjs']) {
            const pid = Object.keys(pidObj)[0]
            const filename = pid.substring(0,18) + '.gz';
            const rank = pidObj[pid] 

            const jsonInStr = fs.createReadStream(`${passagesInDir}/${filename}`)
                .pipe(createGunzip())
                .pipe(JSONStream.parse())
                .pipe(new Stream.PassThrough({objectMode: true}))

            for await (const doc of jsonInStr) {
                if (doc['pid'] == pid) {
                    const obj = {
                        'qid': qid, 
                        'pid': pid.split('msmarco_passage_')[1], 
                        'rank': rank,
                        'text': doc['passage']
                    };
                    passageOutStream.write(JSON.stringify(obj)+'\n');
                    break;
                 }
            } 
        }      
    }
    passageOutStream.end(); 
}

(async () => {
    await load();
})();