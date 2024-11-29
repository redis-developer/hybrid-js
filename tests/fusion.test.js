import {describe, expect, test} from '@jest/globals';
import { Score, Fusion } from '../dist/models/Fusion.js'

describe('fusion tests', () => {  
    
    const scores = [
        /* TFIDF */ [ new Score('P1', .1874), new Score('P2', .1241), new Score('P3', .081), new Score('P4', .2077), new Score('P5', .0597)],
        /* COS   */ [ new Score('P1', .6761), new Score('P2', .6549), new Score('P3', .7479), new Score('P4', .6304), new Score('P5', .6868)]
    ]
    
    const fusion = new Fusion(scores);

    test('borda', () => {
        const result = fusion.borda(false);
        expect(result).toEqual(['P1','P3','P4','P2','P5']);
    });

    test('dbsf', () => {
        const result = fusion.dbsf(false);
        expect(result).toEqual(['P1','P3','P4','P2','P5']);
    });

    test('rrf', () => {
        const result = fusion.rrf(60, false);
        expect(result).toEqual(['P3','P1','P4','P5','P2']);
    });

    test('rsf', () => {
        const result = fusion.rsf(false);
        expect(result).toEqual(['P1','P3','P4','P2','P5']);
    });

});