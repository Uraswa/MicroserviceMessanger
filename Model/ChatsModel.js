import crypto from "crypto";
import ApplicationCache from "../Websocket/library/ApplicationCache.js";
import PoolWrapper from "../Core/PoolWrapper.js";
import ChatMemberCacheDTO from "../dtos/ChatMemberCacheDTO.js";
import ChatCacheDTO from "../dtos/ChatCacheDTO.js";

// Конфигурация соединений
const pool = new PoolWrapper({
    ports: [6700, 6701, 6702],
    base: {
        user: 'postgres',
        host: 'localhost',
        database: 'postgres',
        password: 'nice'
    }
})

class ChatsModel {

    async getChatParticipants(chatId) {
        let members = await this.getChatMembers(chatId);
        return members.map(v => v['user_id']);
    }

    async createPrivateChat(userId1, userId2, company_id) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');


            const chatResult = await client.query(
                `INSERT INTO chats (chat_name, is_ls, company_id)
                 VALUES ('', true, $1)
                 RETURNING chat_id`, [company_id]
            );
            const chatId = chatResult.rows[0].chat_id;

            let insertChatMembersRes = await client.query(
                `INSERT INTO chat_member (chat_id, user_id)
                 VALUES ($1, $2),
                        ($1, $3)
                 RETURNING *`,
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

    async createGroupChat(creatorId, chatName, company_id) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const chatResult = await client.query(
                `INSERT INTO chats (chat_name, is_ls, company_id)
                 VALUES ($1, false, $2)
                 RETURNING chat_id`,
                [chatName, company_id]
            );
            const chatId = chatResult.rows[0].chat_id;

            let chat_member_res = await client.query(
                `INSERT INTO chat_member (chat_id, user_id, invited_by, is_admin)
                 VALUES ($1, $2, null, true)
                 RETURNING *`,
                [chatId, creatorId]
            );

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
            VALUES ($1, $2, $3)
            RETURNING *`;
        const result = await pool.query(query, [chatId, creatorId, link], true);
        if (result) return link;
        return undefined;
    }

    async leaveChat(userId, chatId) {
        let wasChatDeleted = false;

        let callback = async () => {

            const leaveResult = await pool.query(
                `UPDATE chat_member
                 SET is_chat_hidden = TRUE
                 WHERE user_id = $1
                   and chat_id = $2
                 RETURNING *`, [userId, chatId], true
            );


            if (leaveResult.rows[0]) {
                let members = await this.getChatMembers(chatId, false, false, true);

                let activeChatMembers = 0;
                for (let member of members) {
                    if (member.is_chat_hidden || member.is_kicked) continue;
                    activeChatMembers = 1;
                    break;
                }

                //нужно удалить чат
                if (activeChatMembers === 0) {
                    let deleteRes = await pool.query(`DELETE
                                                      FROM chats
                                                      WHERE chat_id = $1`, [chatId], true);
                    wasChatDeleted = true;

                    return {success: true, members: []}
                }


                return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
            } else {
                return {
                    success: false
                }
            }
        }

        let result = await ApplicationCache.updateChatMembers(chatId, callback);
        return {success: result.success, wasChatDeleted: wasChatDeleted};
    }

    async kickFromChat(userId, chatId) {

        let callback = async () => {

            const kickResult = await pool.query(
                `UPDATE chat_member
                 SET is_kicked = true
                 WHERE user_id = $1
                   and chat_id = $2
                 RETURNING *`, [userId, chatId], true
            )


            if (kickResult.rows[0]) {
                let members = await this.getChatMembers(chatId, false, false, true);
                return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
            } else {
                return {
                    success: false
                }
            }
        }

        let result = await ApplicationCache.updateChatMembers(chatId, callback);
        return result.success;
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

    async addChatMemberToChat(user_id, chat_id, inviter_id) {
        let callback = async () => {

            await pool.query(
                `INSERT INTO chat_member (chat_id, user_id, invited_by)
                 VALUES ($1, $2, $3)`,
                [chat_id, user_id, inviter_id], true
            );

            let members = await this.getChatMembers(chat_id, false, false, true);
            return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
        }

        let result = await ApplicationCache.updateChatMembers(chat_id, callback);
        return result.success;
    }


    async joinChatByInviteLink(userId, link) {

        let linkResult = await pool.query(
            `SELECT chat_id, user_id as inviter_id
             FROM chat_invite_link
             WHERE link = $1`,
            [link]
        );

        if (linkResult.rows.length === 0) {
            return {error: "Invalid invitation link"}
        }

        const {chat_id, inviter_id} = linkResult.rows[0];

        let callback = async () => {

            await pool.query(
                `INSERT INTO chat_member (chat_id, user_id, invited_by)
                 VALUES ($1, $2, $3) ON CONFLICT (chat_id, user_id) DO UPDATE SET is_chat_hidden = false`,
                [chat_id, userId, inviter_id], true
            );

            let members = await this.getChatMembers(chat_id, false, false, true);
            return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
        }

        let result = await ApplicationCache.updateChatMembers(chat_id, callback);
        if (result.success) {
            return {chat_id: chat_id, joined: true}
        } else {
            return {error: true}
        }
    }

    async unhidePrivateChat(chat_id) {
        let callback = async () => {
            let client = await pool.connect();
            try {
                client.query('BEGIN');
                let unhideRes = await client.query(`UPDATE chat_member
                                                    SET is_chat_hidden = FALSE
                                                    WHERE chat_id = $1 
                                                    RETURNING *`, [chat_id])
                if (unhideRes.rows.length !== 2) {
                    client.query('ROLLBACK');
                    return {success: false, members: []}
                }


                client.query('COMMIT');

                let members = await this.getChatMembers(chat_id, false, false, true);

                return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
            } catch (e) {
                client.query('ROLLBACK');
            } finally {
                client.release();
            }

            return {success: false, members: []}
        }

        let result = await ApplicationCache.updateChatMembers(chat_id, callback);
        return result.success;
    }

    async _getMembersCount(chat_id) {
        let query = `SELECT COUNT(*) as cnt
                     FROM chat_member
                     WHERE chat_id = $1`;
        let result = await pool.query(query, [chat_id]);

        let firstRow = result.rows[0];
        if (!firstRow) return -1;

        return firstRow.cnt;
    }

    async deleteGroupChat(chatId) {

        let callback = async () => {
            const result = await pool.query(
                `DELETE
                 FROM chats
                 WHERE chat_id = $1
                 RETURNING *`,
                [chatId], true
            );

            if (result.rows.length > 0) {
                return {members: [], success: true}
            } else {
                return {success: false}
            }
        }

        let updateRes = await ApplicationCache.updateChatMembers(chatId, callback);
        return updateRes.success;
    }

    async deletePrivateChat(chatId) {
        let callback = async () => {
            let is_anybody_blocked = false;
            let client = await pool.connect();
            let error = false;
            let members = [];
            try {
                await client.query('BEGIN');

                members = await client.query('SELECT * FROM chat_member WHERE chat_id = $1 FOR UPDATE', [chatId]);


                if (members.rows.length === 2) {
                    is_anybody_blocked = members.rows[0].is_blocked || members.rows[1].is_blocked;
                }

                // тогда не удаляем чат, чтобы пользователь не разблокировался.
                if (is_anybody_blocked) {
                    members = await client.query('UPDATE chat_member SET is_chat_hidden = TRUE WHERE chat_id= $1 RETURNING *', [chatId])
                } else {
                    await client.query('DELETE FROM chats WHERE chat_id = $1', [chatId])
                }

                await client.query('COMMIT');


            } catch (e) {
                await client.query('ROLLBACK');
                error = true;
            } finally {
                client.release();
            }

            if (error) {
                return {success: false}
            }

            if (is_anybody_blocked) {
                return {success: true, members: members.rows.map(m => ChatMemberCacheDTO(m))}
            } else {
                return {success: true, members: []}
            }

        }

        let updateRes = await ApplicationCache.updateChatMembers(chatId, callback);
        return updateRes.success;
    }

    async updateGroupChat(chatId, newChatName) {
        const result = await pool.query(
            `UPDATE chats
             SET chat_name = $2
             WHERE chat_id = $1
               AND is_ls = false
             RETURNING *`,
            [chatId, newChatName], true
        );

        return result.rows[0];
    }

    async getChats(userId, filters = {}) {
        let query = `
            SELECT c.chat_id,
                   c.chat_id,
                   c.chat_name,
                   c.is_ls,
                   (CASE
                        WHEN c.is_ls = true
                            THEN (SELECT user_id
                                  FROM chat_member
                                  WHERE user_id != $1
                                    and chat_id = c.chat_id
                                  LIMIT 1)
                        ELSE NULL
                       END
                       )                               as other_user_id,
                   (c.created_time AT TIME ZONE 'UTC') as created_time
            FROM chats c
                     JOIN chat_member cm ON c.chat_id = cm.chat_id and cm.is_kicked = false
            WHERE cm.user_id =
                  $1
              and cm.is_chat_hidden = false`;

        const values = [userId];
        let paramIndex = values.length + 1;

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

        if (filters.chat_id) {
            query += ` AND c.chat_id = $${paramIndex}`;
            values.push(filters.chat_id);
            paramIndex++;
        }

        query += ` ORDER BY c.created_time DESC `;

        const result = await pool.query(query, values);
        return result.rows;
    }

    async getChatById(chatId) {
        // let cachedChat = await ApplicationCache.getKeyJson("chat" + chatId);
        // if (cachedChat) return cachedChat;

        const query = `SELECT chat_id, chat_name, is_ls, created_time, company_id
                       FROM chats
                       WHERE chat_id = $1`;
        const values = [chatId];
        const result = await pool.query(query, values);

        if (result.rows[0]) {
            await ApplicationCache.setKey("chat" + chatId, JSON.stringify(ChatCacheDTO(result.rows[0])))
        }

        return result.rows[0];
    }

    async getChatByOtherUserId(user_id, other_user_id) {
        const query = `SELECT c.chat_id
                       FROM chats c
                                JOIN chat_member cm1 ON (cm1.user_id = $1 and cm1.chat_id = c.chat_id)
                                JOIN chat_member cm2 ON (cm2.user_id = $2 and cm2.chat_id = c.chat_id)
                       WHERE c.is_ls = true
                       GROUP BY c.chat_id`
        const values = [user_id, other_user_id];
        const result = await pool.query(query, values);

        if (result.rows[0]) {
            await ApplicationCache.setKey("chat" + result.rows[0].chat_id, JSON.stringify(ChatCacheDTO(result.rows[0])))
        }

        return result.rows[0];
    }

    async getChatMember(chat_id, user_id, must_be_not_kicked = true) {
        if (must_be_not_kicked) {
            let cacheResponse = await ApplicationCache.getChatMember(chat_id, user_id, false);
            if (cacheResponse === false) return undefined;
            if (cacheResponse) return cacheResponse;
        }

        const query = `
            SELECT *
            FROM chat_member
            WHERE chat_id = $1
              and user_id = $2 ${must_be_not_kicked ? 'and is_kicked = false' : ''}
        `
        const result = await pool.query(query, [chat_id, user_id]);
        return result.rows[0];
    }

    //valid means sees chat
    async getValidChatMember(chat_id, user_id) {
        let chat_member = await this.getChatMember(chat_id, user_id, true);
        if (chat_member.is_chat_hidden) return undefined;
        return chat_member;
    }

    async getWriterChatMember(chat_id, user_id) {
        let validChatMember = await this.getValidChatMember(chat_id, user_id);
        if (validChatMember.is_blocked) return undefined;
        return validChatMember;
    }

    async blockUnblockUserInChat(chat_id, other_user_id, block_state) {

        let callback = async () => {
            const query = "UPDATE chat_member SET is_blocked = $1 WHERE chat_id = $2 and user_id = $3 RETURNING *";
            const result = await pool.query(query, [block_state, chat_id, other_user_id], true);

            // console.log("CREATING INTERVAL")
            // await new Promise((res, rej) => {
            //     setTimeout(res, 15000)
            // });
            // console.log("URA INTERVAL FINISHED")

            if (result.rows[0]) {
                let members = await this.getChatMembers(chat_id, false, false, true);
                return {members: members.map(v => ChatMemberCacheDTO(v)), success: true}
            } else {
                return {success: false}
            }
        }

        let updateRes = await ApplicationCache.updateChatMembers(chat_id, callback);
        return updateRes.success;
    }


    async getChatMembers(chat_id, is_kicked = false, cache_on = true, from_master = false) {
        if (cache_on) {
            let cachedMembers = await ApplicationCache.getChatMembers(chat_id, false);

            if (cachedMembers) return cachedMembers;
        }

        let query = `
            SELECT user_id, is_admin, is_blocked, is_chat_hidden
            FROM chat_member
            WHERE chat_id = $1
              and is_kicked = $2
        `

        const result = await pool.query(query, [chat_id, false], from_master);

        if (result.rows.length > 0 && cache_on) {
            await ApplicationCache.trySetChatMembers(chat_id, result.rows.map(v => ChatMemberCacheDTO(v)));
        }

        return result.rows;
    }
}

export default new ChatsModel();