import crypto from "crypto";
import pg from 'pg'
import MessagesModel from "./MessagesModel.js";

const {Pool} = pg;

const pool = new Pool({
    user: 'nice',
    host: 'localhost',
    database: 'chats',
    password: 'nice',
    port: 5432,
});


class ChatsModel {

    async getChatParticipants(chatId) {
        try {
            const query = await pool.query(`SELECT user_id
                                            FROM chat_member
                                            WHERE chat_id = $1`, [chatId])

            return query.rows.map(v => v['user_id']);

        } catch (e) {

        }
    }

    async chooseShard() {
        return MessagesModel.chooseShard();
    }

    async createPrivateChat(userId1, userId2) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let shardIndex = await this.chooseShard();

            const chatResult = await client.query(
                `INSERT INTO chats (chat_name, is_ls, shard_index)
                 VALUES ('', true, $1) RETURNING chat_id`, [shardIndex]
            );
            const chatId = chatResult.rows[0].chat_id;

            await client.query(
                `INSERT INTO chat_member (chat_id, user_id)
                 VALUES ($1, $2),
                        ($1, $3)`,
                [chatId, userId1, userId2]
            );

            await client.query('COMMIT');
            return {chat_id: chatId, is_ls: true};
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async createGroupChat(creatorId, chatName, initialMembers = []) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let shardIndex = await this.chooseShard();

            const chatResult = await client.query(
                `INSERT INTO chats (chat_name, is_ls, shard_index)
                 VALUES ($1, false, $2) RETURNING chat_id`,
                [chatName, shardIndex]
            );
            const chatId = chatResult.rows[0].chat_id;

            await client.query(
                `INSERT INTO chat_member (chat_id, user_id, invited_by, is_admin)
                 VALUES ($1, $2, null, true)`,
                [chatId, creatorId]
            );

            if (initialMembers.length > 0) {
                const values = initialMembers.map(userId =>
                    `(${chatId}, ${userId}, ${creatorId}, false)`).join(',');
                await client.query(
                    `INSERT INTO chat_member (chat_id, user_id, invited_by, is_admin)
                     VALUES ${values}`
                );
            }

            await client.query('COMMIT');
            return {chat_id: chatId, is_ls: false};
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getOrCreateInvitationLink(chatId, creatorId) {

        const queryGet = await pool.query(`
            SELECT link
            FROM chat_invite_link
            WHERE chat_id = $1
              and user_id = $2
        `, [chatId, creatorId]);

        if (queryGet.rows[0]) {
            return queryGet.rows[0].link;
        }

        let link = crypto.randomBytes(64).toString('hex');

        const query = `
            INSERT INTO chat_invite_link (chat_id, user_id, link)
            VALUES ($1, $2, $3) RETURNING *`;
        const result = await pool.query(query, [chatId, creatorId, link]);
        if (result) return link;
        return undefined;
    }

    async leaveChat(userId, chatId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const leaveResult = await client.query(
                `DELETE
                 FROM chat_member
                 WHERE user_id = $1
                   and chat_id = $2 RETURNING *`, [userId, chatId]
            )

            await client.query('COMMIT');
            return !!leaveResult.rows[0]
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    }

    async kickFromChat(userId, chatId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const leaveResult = await client.query(
                `UPDATE chat_member
                 SET is_kicked = true
                 WHERE user_id = $1
                   and chat_id = $2 RETURNING *`, [userId, chatId]
            )

            await client.query('COMMIT');
            return !!leaveResult.rows[0]
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    }

    async getChatIdByInviteLink(link) {
        const query = `
            SELECT chat_id
            FROM chat_invite_link
            WHERE link = $1
        `
        const result = await pool.query(query, [link]);
        if (result.rows[0]) return result.rows[0].chat_id;
        return undefined;
    }


    async joinChatByInviteLink(userId, link) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const linkResult = await client.query(
                `SELECT chat_id, user_id as inviter_id
                 FROM chat_invite_link
                 WHERE link = $1`,
                [link]
            );

            if (linkResult.rows.length === 0) {
                return {error: "Invalid invitation link"}
            }

            const {chat_id, inviter_id} = linkResult.rows[0];

            await client.query(
                `INSERT INTO chat_member (chat_id, user_id, invited_by)
                 VALUES ($1, $2, $3)`,
                [chat_id, userId, inviter_id]
            );

            await client.query('COMMIT');
            return {chat_id, joined: true};
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async deleteGroupChat(chatId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `DELETE
                 FROM chats
                 WHERE chat_id = $1 RETURNING *`,
                [chatId]
            );

            await client.query('COMMIT');
            return result.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async updateGroupChat(chatId, newChatName) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE chats
                 SET chat_name = $2
                 WHERE chat_id = $1
                   AND is_ls = false RETURNING *`,
                [chatId, newChatName]
            );

            await client.query('COMMIT');
            return result.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getChats(userId, filters = {}) {
        let query = `
            SELECT c.chat_id,
                   c.chat_id,
                   c.chat_name,
                   c.shard_index,
                   c.is_ls,
                   (CASE
                        WHEN c.is_ls = true
                            THEN (SELECT user_id FROM chat_member WHERE user_id != $1 and
                    chat_id = c.chat_id LIMIT 1) ELSE NULL
            END
            ) as other_user_id,
    c.created_time
FROM chats c
         JOIN chat_member cm ON c.chat_id = cm.chat_id and cm.is_kicked = false
WHERE cm.user_id =
            $1`;

        const values = [userId];
        let paramIndex = 2;

        if (filters.isLs !== undefined) {
            query += ` AND c.is_ls = $${paramIndex}`;
            values.push(filters.isLs);
            paramIndex++;
        }

        if (filters.search) {
            query += ` AND c.chat_name ILIKE $${paramIndex}`;
            values.push(`%${filters.search}%`);
            paramIndex++;
        }

        query += ` ORDER BY c.created_time DESC `;

        const result = await pool.query(query, values);
        return result.rows;
    }

    async getChatById(chatId) {
        const query = `SELECT chat_id, chat_name, is_ls, shard_index, created_time
                       FROM chats
                       WHERE chat_id = $1`;
        const values = [chatId];
        const result = await pool.query(query, values);
        return result.rows[0];
    }

    async getChatByOtherUserId(user_id, other_user_id) {
        const query = `SELECT c.chat_id
                       FROM chats c
                                JOIN chat_member cm1 ON (cm1.user_id = $1 and cm1.chat_id = c.chat_id)
                                JOIN chat_member cm2 ON (cm2.user_id = $2 and cm1.chat_id = c.chat_id)
                       WHERE c.is_ls = true
                       GROUP BY c.chat_id`
        const values = [user_id, other_user_id];
        const result = await pool.query(query, values);
        return result.rows[0];
    }

    async getChatMember(chat_id, user_id, must_be_not_kicked = true) {
        const query = `
            SELECT *
            FROM chat_member
            WHERE chat_id = $1
              and user_id = $2 ${must_be_not_kicked ? 'and is_kicked = false' : ''}
        `
        const result = await pool.query(query, [chat_id, user_id]);
        return result.rows[0];
    }

    async blockUnblockUserInChat(chat_id, other_user_id, block_state) {
        const query = "UPDATE chat_member SET is_blocked = $1 WHERE chat_id = $2 and user_id = $3 RETURNING *";
        const result = await pool.query(query, [block_state, chat_id, other_user_id]);
        return result.rows[0];
    }


    async getChatMembers(chat_id, is_kicked = false) {
        const query = `
            SELECT user_id, is_admin, is_blocked
            FROM chat_member
            WHERE chat_id = $1
              and is_kicked = $2
        `

        const result = await pool.query(query, [chat_id, is_kicked]);
        return result.rows;
    }
}

export default new ChatsModel();