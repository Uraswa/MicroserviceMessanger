import pg from "pg";
import {SHARDS} from "./ShardsManager.js";
import PoolWrapper from "../Core/PoolWrapper.js";

const {Pool} = pg;

// Конфигурация соединений
const pool = new PoolWrapper({
    ports: [6800, 6801, 6802],
    base: {
        user: 'postgres',
        host: 'localhost',
        database: 'postgres',
        password: 'nice'
    }
})

const SHARDS_CACHE = new Map();

class ChatToShardModel {

    async getChatsShards(chatIds) {

        let chatIdsJoined = '';
        let i = 0;
        for (let chatId of chatIds) {
            chatIdsJoined += Number.parseInt(chatId).toString();
            chatIdsJoined += i === chatIds.length - 1 ? '' : ', '
            i += 1
        }

        let query = `
            SELECT shard_index, string_agg(cast(chat_id as varchar), ',') as chats
            FROM chats_to_shard
            WHERE chat_id IN (${chatIdsJoined})
            GROUP BY shard_index
        `;

        let result = await pool.query(query);
        return result.rows;

    }

    async getShard(chatId) {
        let cachedShardIndex = SHARDS_CACHE.get(chatId);
        if (cachedShardIndex) {
            return SHARDS[cachedShardIndex];
        }

        let shard_index = await this.getOrCreateShardIndex(chatId);
        SHARDS_CACHE[chatId] = shard_index;

        return SHARDS[shard_index];
    }


    async chooseShard() {
        let promises = [];
        for (let shard of SHARDS) {
            promises.push(shard.pool.query(`SELECT reltuples::bigint AS estimate
                                            FROM pg_class
                                            where relname = 'messages'`))
        }
        let shardStats = await Promise.all(promises);
        let minimum = Number.MAX_SAFE_INTEGER;
        let minimumShard = 0;

        let shardIndex = 0;
        for (let shardRes of shardStats) {
            let estimated = Number.parseInt(shardRes.rows[0].estimate);
            if (estimated < minimum) {
                minimum = estimated;
                minimumShard = shardIndex;
            }
            shardIndex++;
        }

        return minimumShard;
    }

    async getOrCreateShardIndex(chatId) {
        const query = `SELECT shard_index
                       FROM chats_to_shard
                       WHERE chat_id = $1`;
        const values = [chatId];
        const result = await pool.query(query, values);

        if (!result.rows[0]) {
            const shardIndex = await this.chooseShard();
            const insertShardInfoQuery = `INSERT INTO chats_to_shard (chat_id, shard_index) VALUES ($1, $2)`;
            const insertShardInfoRes = await pool.query(insertShardInfoQuery, [chatId, shardIndex], true);
            return shardIndex;
        }

        return result.rows[0].shard_index;
    }

}

export default new ChatToShardModel();