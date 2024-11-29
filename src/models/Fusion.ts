import assert from 'node:assert/strict';

type assocArrayNum = { 
    [key: string]: number 
};

export class Score {
    id: string;
    score: number;
    rank: number;

    constructor(id:string, score:number, rank:number=0) {
        this.id = id;
        this.score = score;
        this.rank = rank;
    }
}

export class Fusion {
    scores: Array<Array<Score>>;
    weights: Array<number>;
    rankings: Array<Array<string>>;

    constructor(scores: Array<Array<Score>>, weights: Array<number> = new Array(scores.length).fill(1)) {
        this.scores = scores;
        this.weights = weights;
        this.rankings = this.#validateInput();
    }

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

    borda(showScores: boolean = false): Array<string> {
        const rankScores: assocArrayNum = {};
        this.rankings[0].forEach((elm) => rankScores[elm] = 0);

        this.rankings.forEach((ranking, i) => {
            ranking.forEach((rank, j) => {
                rankScores[rank] += this.weights[i] * (ranking.length-j);
            });
        });

        const result = Object.entries(rankScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`borda: ${JSON.stringify(result)}`);
        } 
        return result.map((elm) => elm[0]);
    }

    dbsf(showScores: boolean = false): Array<string> {
        const zscore = (val: number, mean: number, std: number): number => {
            return (val-mean)/std;
        };

        const zScores: assocArrayNum = {};
        this.scores[0].forEach((elm) => zScores[elm.id] = 0);
        this.scores.forEach((scoreArr, i) => {
            const mean = scoreArr.reduce((a, b) => a + b.score/scoreArr.length, 0);
            const std = Math.sqrt(scoreArr.reduce((a, b) => a + Math.pow(b.score - mean, 2), 0)/scoreArr.length);
            scoreArr.forEach((elm) => {
                zScores[elm.id] += this.weights[i] * zscore(elm.score, mean, std);
            });
        });

        const result = Object.entries(zScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`dbsf: ${JSON.stringify(result.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return result.map((elm) => elm[0]);
    }

    rsf(showScores: boolean = false): Array<string> {
        const normalize = (val:number, max:number, min:number): number => {
            return (val-min)/(max - min);
        }

        const normScores: assocArrayNum = {};
        this.scores[0].forEach((elm) => normScores[elm.id] = 0);
        this.scores.forEach((scoreArr, i) => {
            const max = scoreArr.reduce((a,b) => a > b.score ? a : b.score, Number.NEGATIVE_INFINITY);
            const min = scoreArr.reduce((a,b) => a < b.score ? a : b.score, Number.POSITIVE_INFINITY);
            scoreArr.forEach((elm) => {
                normScores[elm.id] += this.weights[i] * normalize(elm.score, max, min);
            });
        });

        const result = Object.entries(normScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`rsf: ${JSON.stringify(result.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return result.map((elm) => elm[0]);
    }

    rrf(k=60, showScores: boolean = false): Array<string> {
        assert(k > 0);

        const rankScores: assocArrayNum = {};
        this.rankings[0].forEach((elm) => rankScores[elm] = 0);

        this.rankings.forEach((ranking, i) => {
            ranking.forEach((elm, j) => {
                rankScores[elm] += this.weights[i] * 1/(j+k);
            });
        }); 

        const result = Object.entries(rankScores).sort((a,b) => b[1] - a[1]);
        if (showScores) {
            console.log(`rrf: ${JSON.stringify(result.map((elm) => [elm[0], parseFloat(elm[1].toFixed(4))]))}`);
        }
        return result.map((elm) => elm[0]);
    }
}