import { Score } from './models/Fusion.js'

export enum EmbeddingType {
    Query = 'query',
    Passage = 'passage'
};

export enum QueryType {
    KNN,
    FTS,
    HYB
};

export type NdcgResultType = {
    qid: string,
    ndcg: number
};

export type QueryScores = {
    qid: string,
    results: {
        cos: Array<Score>,
        fts: Array<Score>
    }
};

export type RankedScore = {
    id: string,
    score: number,
    rank: number
};

export type Relevance = {
    pid: string,
    relevance: number
};

export type SearchResult = {
    qid: string,
    scores: Array<RankedScore>
};