import assert from 'node:assert/strict';

type assocArrayNum = { 
    [key: string]: number 
};

/** 
 * Class representing a score - vector distance or text relevance score 
 * @class
 */
export class Score {
    id: string;
    score: number;
    rank: number;

    /**
     * @constructor
     * @param {string} id ID of text passage
     * @param {number} score  Vector distance or text relevance 
     * @param {rank} rank   The passage's original MS Marco rank
     */
    constructor(id:string, score:number, rank:number=0) {
        this.id = id;
        this.score = score;
        this.rank = rank;
    }
}

/** 
 * Class implementing various rank fusion algorithms 
 * @class
 */
export class Fusion {
    scores: Array<Array<Score>>;
    weights: Array<number>;
    rankings: Array<Array<string>>;

    /**
     * @constructor
     * @param {Array<Array<Score>>}  scores arrays of Score objects
     * @param {Array<number>} weights optional array of weights for each score array
     */
    constructor(scores: Array<Array<Score>>, weights: Array<number> = new Array(scores.length).fill(1)) {
        this.scores = scores;
        this.weights = weights;
        this.rankings = this.#validateInput();
    }

    /**
     * Performs the following validation checks:
     * -    scores and weight lengths are equal
     * -    every score array is of the same length 
     * -    every score array is composed of the same IDs
     * The score array is sorted in descending order and a new array (rankings) is returned 
     * with only the IDs in rank order by score for each score array.
     * 
     * @private
     * @function
     * @returns {Array<Array<string>>}
     */
    #validateInput(): Array<Array<string>> {
        assert.equal(this.scores.length, this.weights.length);
        
        const rankings: Array<Array<string>> = [];
        const ids = new Set(this.scores[0].map(elm => elm.id));       
        this.scores.forEach((scoreArr) => {
            assert.equal(ids.size, scoreArr.length);
            const sorted: Array<string> = scoreArr.sort((a,b) => b.score - a.score).map((elm) => elm.id);
            for (const id of ids) {
                assert(sorted.includes(id));
            }
            rankings.push(sorted);
        });
        return rankings;
    }

    /**
     * Implements the Borda Count Method.
     *  -   New array of objects, bordaScores, is created.  Each object represent an ID and its 
     *      accumulated score.
     *  -   Each ID is given a score that represents the summation of its ranks for 
     *      each rank list in the rankings array.
     * 
     * @public
     * @function
     * @param {boolean} showScores  enables display of the final score list
     * @returns {Array<string>} array of ids sorted in descending order by their Borda scores
     * @example
     *  const scores = [
     *      [ new Score('P1', .1874), new Score('P2', .1241), new Score('P3', .081), new Score('P4', .2077), new Score('P5', .0597)],
     *      [ new Score('P1', .6761), new Score('P2', .6549), new Score('P3', .7479), new Score('P4', .6304), new Score('P5', .6868)]
     *  ];
     *  const fusion = new Fusion(scores);
     *  fusion.borda(true);
     * 
     *  // borda: [["P1",7],["P3",7],["P4",6],["P2",5],["P5",5]]
     */
    borda(showScores: boolean = false): Array<string> {
        const bordaScores: assocArrayNum = {};
        this.rankings[0].forEach((elm) => bordaScores[elm] = 0);

        this.rankings.forEach((rankArr, i) => {
            rankArr.forEach((rank, j) => {
                bordaScores[rank] += this.weights[i] * (rankArr.length-j);
            });
        });

        const sorted = Object.entries(bordaScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`borda: ${JSON.stringify(sorted)}`);
        } 
        return sorted.map((elm) => elm[0]);
    }

    /**
     *  Implements the Distributed-Based Score Fusion (DBSF) algorithm.
     *  -   New array of objects, dbsfScores, is created.  Each object represent an ID and its 
     *      accumulated zscore.
     *  -   Mean and STD are calculated for each array of scores.
     *  -   zscore is calculated for each score in an array.
     *  -   Each ID is given a score that represents the summation of zscores across all score arrays.
     *  -   Final output is a single array of IDs, sorted in descending order by accumulated zscores.
     * 
     * @public
     * @function
     * @param {boolean} showScores enables display of the final score list
     * @returns {Array<string>} array of ids sorted in descending order by their DBSF scores
     * @example
     *  const scores = [
     *      [ new Score('P1', .1874), new Score('P2', .1241), new Score('P3', .081), new Score('P4', .2077), new Score('P5', .0597)],
     *      [ new Score('P1', .6761), new Score('P2', .6549), new Score('P3', .7479), new Score('P4', .6304), new Score('P5', .6868)]
     *  ];
     *  const fusion = new Fusion(scores);
     *  fusion.dbsf(true);
     * 
     *  // dbsf: [["P1",0.88],["P3",0.8611],["P4",0.0713],["P2",-0.7538],["P5",-1.0586]]
     */
    dbsf(showScores: boolean = false): Array<string> {
        const zscore = (val: number, mean: number, std: number): number => {
            return (val - mean) / std;
        };

        const dbsfScores: assocArrayNum = {};
        this.scores[0].forEach((elm) => dbsfScores[elm.id] = 0);
        this.scores.forEach((scoreArr, i) => {
            const mean = scoreArr.reduce((a, b) => a + b.score/scoreArr.length, 0);
            const std = Math.sqrt(scoreArr.reduce((a, b) => a + Math.pow(b.score - mean, 2), 0)/scoreArr.length);
            scoreArr.forEach((elm) => {
                dbsfScores[elm.id] += this.weights[i] * zscore(elm.score, mean, std);
            });
        });

        const sorted = Object.entries(dbsfScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`dbsf: ${JSON.stringify(sorted.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return sorted.map((elm) => elm[0]);
    }

    /**
     *  Implements the Reciprocal Rank Fusion (RRF) algorithm.
     *  -   New array of objects, rrfScores, is created.  Each object represent an ID and its 
     *      accumulated reciprocal rank score.
     *  -   An item's score is calculated by summing the 1/(rank + k) for each score list.
     *  -   Each ID is given a score that represents the summation of reciproal rank.
     *      scores across all score arrays.
     *  -   Final output is a single array of IDs, sorted in descending order by accumulated reciprocal
     *      rank scores.
     * 
     * @public
     * @function
     * @param {number} k additional factor added to the reciprocal rank
     * @param {boolean} showScores enables display of the final score list
     * @returns {Array<string>} array of ids sorted in descending order by their RRF scores
     * @example
     *  const scores = [
     *      [ new Score('P1', .1874), new Score('P2', .1241), new Score('P3', .081), new Score('P4', .2077), new Score('P5', .0597)],
     *      [ new Score('P1', .6761), new Score('P2', .6549), new Score('P3', .7479), new Score('P4', .6304), new Score('P5', .6868)]
     *  ];
     *  const fusion = new Fusion(scores);
     *  fusion.rrf(60, true);
     * 
     *  // rrf: [["P3",0.0325],["P1",0.0325],["P4",0.0323],["P5",0.032],["P2",0.032]]
     */
    rrf(k: number = 60, showScores: boolean = false): Array<string> {
        assert(k > 0);
        const rrfScores: assocArrayNum = {};
        this.rankings[0].forEach((elm) => rrfScores[elm] = 0);

        this.rankings.forEach((ranking, i) => {
            ranking.forEach((elm, j) => {
                rrfScores[elm] += this.weights[i] * 1/(j+k);
            });
        }); 

        const sorted = Object.entries(rrfScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`rrf: ${JSON.stringify(sorted.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return sorted.map((elm) => elm[0]);
    }

    /**
     * Implements the Relative Score Fusion (RSF) algorithm.
     *  -   New array of objects, rsfScores, is created.  Each object represent an ID and its 
     *      accumulated relative score.
     *  -   The min and max of each score array is calculated
     *  -   An item's score is calculated by summing up its normalized score in each score array
     *  -   Final output is a single array of IDs, sorted in descending order by accumulated relative
     *      scores.
     * 
     * @public
     * @function
     * @param {boolean} showScores enables display of the final score list
     * @returns {Array<string>} array of ids sorted in descending order by their RSF scores
     * @example
     *  const scores = [
     *      [ new Score('P1', .1874), new Score('P2', .1241), new Score('P3', .081), new Score('P4', .2077), new Score('P5', .0597)],
     *      [ new Score('P1', .6761), new Score('P2', .6549), new Score('P3', .7479), new Score('P4', .6304), new Score('P5', .6868)]
     *  ];
     *  const fusion = new Fusion(scores);
     *  fusion.rsf(true);
     * 
     *  // rsf: [["P1",1.2518],["P3",1.1439],["P4",1],["P2",0.6436],["P5",0.48]]
     */
    rsf(showScores: boolean = false): Array<string> {
        const normalize = (val:number, max:number, min:number): number => {
            return (val - min) / (max - min);
        }

        const rsfScores: assocArrayNum = {};
        this.scores[0].forEach((elm) => rsfScores[elm.id] = 0);
        this.scores.forEach((scoreArr, i) => {
            const max = scoreArr.reduce((a,b) => a > b.score ? a : b.score, Number.NEGATIVE_INFINITY);
            const min = scoreArr.reduce((a,b) => a < b.score ? a : b.score, Number.POSITIVE_INFINITY);
            scoreArr.forEach((elm) => {
                rsfScores[elm.id] += this.weights[i] * normalize(elm.score, max, min);
            });
        });

        const sorted = Object.entries(rsfScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`rsf: ${JSON.stringify(sorted.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return sorted.map((elm) => elm[0]);
    }
}