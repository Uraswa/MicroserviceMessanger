import ChatToShardModel from "./ChatToShardModel.js";

class MessagesModel {

    async getShard(chatId) {
        return await ChatToShardModel.getShard(chatId);
    }


    async createMessage(chatId, userId, text) {
        const shard = await this.getShard(chatId);
        console.log(`Using ${shard.name} for chat ${chatId}`);

        const client = await shard.pool.connect();
        try {
            const res = await client.query(
                'INSERT INTO messages (chat_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
                [chatId, userId, text]
            );
            return res.rows[0];
        } finally {
            client.release();
        }
    }

    async updateMessage(chatId, messageId, newText) {

        const shard = await this.getShard(chatId);
        console.log(`Using ${shard.name} for chat ${chatId}`);

        const query = `
            UPDATE messages
            SET text = $1
            WHERE message_id = $2 RETURNING *`;
        const result = await shard.pool.query(query, [newText, messageId], true);
        return result.rows[0];
    }

    async deleteMessage(chatId, messageId) {
        const shard = await this.getShard(chatId);
        console.log(`Using ${shard.name} for chat ${chatId}`);

        const query = `DELETE
                       FROM messages
                       WHERE message_id = $1 RETURNING *`;
        const result = await shard.pool.query(query, [messageId], true);
        return result.rows[0];
    }

    async getMessageById(chatId, messageId) {
        const shard = await this.getShard(chatId);
        console.log(`Using ${shard.name} for chat ${chatId}`);

        const query = `SELECT *
                       FROM messages
                       WHERE message_id = $1`;
        const values = [messageId];
        const result = await shard.pool.query(query, values);
        return result.rows[0];
    }

    async getLastChatMessage(chat_id) {
        const shard = await this.getShard(chat_id);
        console.log(`Using ${shard.name} for chat ${chat_id}`);
        const query = `SELECT *
                       FROM messages
                       WHERE chat_id = $1
                       ORDER BY timestamp DESC LIMIT 1`;
        const values = [chat_id];
        const result = await shard.pool.query(query, values);
        return result.rows[0];
    }

    async getLastMessagesByChat(chatIds) {

        let gropedByShard = await ChatToShardModel.getChatsShards(chatIds);
        let result = [];

        for (let shardGroup of gropedByShard) {
            let shard = await this.getShard(shardGroup.shard_index);

            let query = `SELECT DISTINCT
                         ON (m.chat_id)
                             m.chat_id, m.text, m.user_id, m.timestamp, m.message_id
                         FROM messages m
                         WHERE m.chat_id IN (${shardGroup.chats})
                         ORDER BY m.chat_id, m.timestamp DESC;`

            let messages = await shard.pool.query(query, []);
            for (let msg of messages.rows) {
                result.push(msg);
            }
        }

        return result;
    }

    async getMessages(chat_id, last_message_id) {
        const shard = await this.getShard(chat_id);
        console.log(`Using ${shard.name} for chat ${chat_id}`);
        const query = `
            SELECT *
            FROM messages
            WHERE chat_id = $1 ${last_message_id ? 'and message_id < $2' : ''}
            ORDER BY message_id DESC
                LIMIT 25
        `
        let values = [chat_id];
        if (last_message_id) {
            values.push(last_message_id)
        }

        const result = await shard.pool.query(query, values);
        return result.rows;
    }

    async clearMessages(chat_id) {
        const shard = await this.getShard(chat_id);
        console.log(`Using ${shard.name} for chat ${chat_id}`);
        const query = `
            DELETE
            FROM messages
            WHERE chat_id = $1
        `
        let values = [chat_id];
        await shard.pool.query(query, values, true);
    }
}

export default new MessagesModel();