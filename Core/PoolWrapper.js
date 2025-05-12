import pg from "pg";

const {Pool} = pg;

class PoolWrapper {

    masterPool;
    slavePools = [];
    currentSlaveIndex = 0;


    constructor(config) {

        //lazy configuration
        if ("ports" in config) {

            let base = config.base;

            let isFirst = true;
            for (let port of config.ports) {

                let cfg = {
                    ...base
                }
                cfg.port = port;

                if (isFirst) {
                    this.masterPool = new Pool(cfg);
                } else {
                    this.slavePools.push(new Pool(cfg))
                }

                isFirst = false;
            }

        } else {
            this.masterPool = new Pool(config.master);
            this.slavePools = config.slaves.map(slave_cfg => new Pool(slave_cfg))
        }

    }

    async query(q, params = [], is_writing = false){

        let pool;
        if (is_writing) {
            pool = this.masterPool;
        } else {
            pool = this.slavePools[this.currentSlaveIndex];
            this.currentSlaveIndex = (this.currentSlaveIndex + 1) % this.slavePools.length;
        }

        return await pool.query(q, params);
    }

    async connect(){
        return await this.masterPool.connect();
    }


}

export default PoolWrapper;