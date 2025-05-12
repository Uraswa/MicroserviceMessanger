import PoolWrapper from "../Core/PoolWrapper.js";

const SHARDS = [
    {
        name: 'shard0',
        pool: new PoolWrapper({
            ports: [6900, 6901, 6902],
            base: {
                user: 'postgres',
                host: 'localhost',
                database: 'postgres',
                password: 'nice'
            }
        })
    },
    {
        name: 'shard1',
        pool: new PoolWrapper({
            ports: [7000, 7001, 7002],
            base: {
                user: 'postgres',
                host: 'localhost',
                database: 'postgres',
                password: 'nice'
            }
        })
    },
    {
        name: 'shard2',
        pool: new PoolWrapper({
            ports: [7100, 7101, 7102],
            base: {
                user: 'postgres',
                host: 'localhost',
                database: 'postgres',
                password: 'nice'
            }
        })
    },
    {
        name: 'shard3',
        pool: new PoolWrapper({
            ports: [7200, 7201, 7202],
            base: {
                user: 'postgres',
                host: 'localhost',
                database: 'postgres',
                password: 'nice'
            }
        })
    }
];


export {
    SHARDS,
}