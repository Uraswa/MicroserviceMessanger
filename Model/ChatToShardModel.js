import pg from "pg";

const {Pool} = pg;

const pool = new Pool({
    user: 'nice',
    host: 'localhost',
    database: 'chats_to_shard',
    password: 'nice',
    port: 5432,
});

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

}

export default new ChatToShardModel();