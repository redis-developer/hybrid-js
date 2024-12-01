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
![architecture](https://docs.google.com/drawings/d/e/2PACX-1vQN-ly-XOxXlf-FEb35WehlstPcHEQeIwxfWit5ZSAHY9OZmxh8JkzTxw2saWRDnP2Jx5CiVmss-KF3/pub?w=856&h=593)  

## Features <a name="features"></a>
- Implementation of the following rank fusion algorithms in Typescript
    - Borda Count Method
    - Distributed-Based Score Fusion (DBSF)
    - Reciprocal Rank Fusion (RRF)
    - Relative Score Fusion (RSF)
- Nvidia NIM-based embeddings
- Redis Software vector similarity search
- Extraction of small test set (10 queries/10 passages each) from [MS MARCO TREC-Deep-Learning](https://github.com/microsoft/msmarco/blob/master/TREC-Deep-Learning.md) data set

## Prerequisites <a name="prerequisites"></a>
- Nvidia GPU
- Nvidia AGC API key
- Docker
- Docker Compose
- nodejs
- npm
- tsc

## Installation <a name="installation"></a>
```bash
git clone git@github.com:redis-developer/hybrid-js.git && cd hybrid-js && npm install
```
- Rename .env_sample to .env and replace the placeholder in API_KEY with your key.

## Usage <a name="usage"></a>
### Environment Start
```bash
docker compose up -d
```
### Environment Stop
```bash
docker compose down
```
### App Build
```bash
npm run build
```
### App Run
```bash
npm start
```