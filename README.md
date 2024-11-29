# Fusion Demo

## Contents
1.  [Summary](#summary)
2.  [Architecture](#architecture)
3.  [Features](#features)
4.  [Prerequisites](#prerequisites)
5.  [Installation](#installation)
6.  [Usage](#usage)


## Summary <a name="summary"></a>
This is a Javascript-based demo of various rank fusion algorithms.  

## Architecture <a name="architecture"></a>
![architecture]()  

## Features <a name="features"></a>
- Implementation of the following rank fusion algorithms in Typescript
    - Borda
    - DBSF
    - RRF
    - RSF
- Nvidia NIM-based embeddings
- Redis Software vector similarity search

## Prerequisites <a name="prerequisites"></a>
- Docker
- Docker Compose
- Node
- NPM
- Typescript
- Nvida AGC API key
- Nvidia GPU

## Installation <a name="installation"></a>
```bash
git clone x && cd hybrid-js && npm install
```
- Rename .env_sample to .env and replace the API key placeholder with your key.

## Usage <a name="usage"></a>
### Environment start-up
```bash
docker compose up -d
```
### Environment shutdown
```bash
docker compose down
```
### Build
```bash
npm run build
```
### Run
```bash
npm start
```
### Test
```bash
npm test
```


