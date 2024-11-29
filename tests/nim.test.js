import axios from 'axios';
import {describe, expect, test} from '@jest/globals';

async function getEmbeddingLen() {
    const res = await axios.post('http://localhost:8000/v1/embeddings', {
        input: ["Hello world"],
        model: "nvidia/nv-embedqa-e5-v5",
        input_type: "passage"
    });
    return res.data.data[0].embedding.length;
}

describe('Embedding tests', () => {
    test('embedding length', async() => {
        const len = await getEmbeddingLen();
        expect(len).toBe(1024);
    });
});