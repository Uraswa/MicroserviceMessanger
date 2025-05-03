import pg from 'pg'
import crypto from "crypto";
import bcrypt from "bcrypt";

const {Pool} = pg;

const pool = new Pool({
    user: 'nice',
    host: 'localhost',
    database: 'postgres',
    password: 'nice',
    port: 5432,
});


async function getChatParticipants(chatId) {
    try {
        const query = await pool.query(`SELECT user_id
                                        FROM chat_member
                                        WHERE chat_id = $1`, [chatId])

        return query.rows;

    } catch (e) {

    }
}

async function getMessageById(messageId) {
    const query = `SELECT *
                   FROM messages
                   WHERE message_id = $1`;
    const values = [messageId];
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function createMessage(chatId, userId, text) {
    const query = `
        INSERT INTO messages (chat_id, user_id, text)
        VALUES ($1, $2, $3) RETURNING *`;
    const values = [chatId, userId, text];
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function updateMessage(messageId, newText) {
    const query = `
        UPDATE messages
        SET text = $1
        WHERE message_id = $2 RETURNING *`;
    const result = await pool.query(query, [newText, messageId]);
    return result.rows[0];
}

async function deleteMessage(messageId) {
    const query = `DELETE
                   FROM messages
                   WHERE message_id = $1 RETURNING *`;
    const result = await pool.query(query, [messageId]);
    return result.rows[0];
}

async function createPrivateChat(userId1, userId2) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const chatResult = await client.query(
            `INSERT INTO chats (chat_name, is_ls)
             VALUES ('', true) RETURNING chat_id`
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

async function createGroupChat(creatorId, chatName, initialMembers = []) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const chatResult = await client.query(
            `INSERT INTO chats (chat_name, is_ls)
             VALUES ($1, false) RETURNING chat_id`,
            [chatName]
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

async function getOrCreateInvitationLink(chatId, creatorId) {

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

async function leaveChat(userId, chatId) {
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

async function kickFromChat(userId, chatId) {
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

async function getChatIdByInviteLink(link) {
    const query = `
        SELECT chat_id
        FROM chat_invite_link
        WHERE link = $1
    `
    const result = await pool.query(query, [link]);
    if (result.rows[0]) return result.rows[0].chat_id;
    return undefined;
}


async function joinChatByInviteLink(userId, link) {
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

async function deleteGroupChat(chatId) {
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

async function updateGroupChat(chatId, newChatName) {
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

async function getLastChatMessage(chat_id) {
    const query = `SELECT *
                   FROM messages
                   WHERE chat_id = $1
                   ORDER BY timestamp DESC LIMIT 1`;
    const values = [chat_id];
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function getChats(userId, filters = {}) {
    let query = `
        SELECT c.chat_id,
               c.chat_id,
               c.chat_name,
               c.is_ls,
               (CASE
                    WHEN c.is_ls = true
                        THEN (SELECT user_id FROM chat_member WHERE user_id != $1 and
                chat_id = c.chat_id LIMIT 1) ELSE NULL
        END
        ) as other_user_id,
    c.created_time,
    m.message_id as last_message_id,
    m.text as last_message_text,
    m.user_id as last_message_user_id,
    (CASE WHEN m.timestamp IS NULL THEN c.created_time ELSE m.timestamp END) as last_message_timestamp
FROM chats c
         JOIN chat_member cm ON c.chat_id = cm.chat_id and cm.is_kicked = false
         LEFT JOIN messages m ON m.message_id = (SELECT m2.message_id
                                                 FROM messages m2
                                                 WHERE m2.chat_id = c.chat_id
                                                 ORDER BY m2.timestamp DESC
                                                 LIMIT 1)
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

    query += ` ORDER BY CASE WHEN m.timestamp IS NULL THEN c.created_time ELSE m.timestamp END DESC `;

    const result = await pool.query(query, values);
    return result.rows;
}

async function getChatById(chatId) {
    const query = `SELECT *
                   FROM chats
                   WHERE chat_id = $1`;
    const values = [chatId];
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function getChatByOtherUserId(user_id, other_user_id) {
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

async function getChatMember(chat_id, user_id, must_be_not_kicked = true) {
    const query = `
        SELECT *
        FROM chat_member
        WHERE chat_id = $1
          and user_id = $2 ${must_be_not_kicked ? 'and is_kicked = false' : ''}
    `
    const result = await pool.query(query, [chat_id, user_id]);
    return result.rows[0];
}

async function blockUnblockUserInChat(chat_id, other_user_id, block_state) {
    const query = "UPDATE chat_member SET is_blocked = $1 WHERE chat_id = $2 and user_id = $3 RETURNING *";
    const result = await pool.query(query, [block_state, chat_id, other_user_id]);
    return result.rows[0];
}

async function getMessages(chat_id, last_message_id) {
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

    const result = await pool.query(query, values);
    return result.rows;
}

async function clearMessages(chat_id) {
    const query = `
        DELETE
        FROM messages
        WHERE chat_id = $1
    `
    let values = [chat_id];
    await pool.query(query, values);
}

async function getChatMembers(chat_id, is_kicked = false) {
    const query = `
        SELECT user_id, is_admin, is_blocked
        FROM chat_member
        WHERE chat_id = $1 and is_kicked = $2
    `

    const result = await pool.query(query, [chat_id, is_kicked]);
    return result.rows;
}

async function getUserById(user_id) {
    const query = `SELECT *
                   FROM users
                   WHERE user_id = $1`;
    const result = await pool.query(query, [user_id]);
    return result.rows[0];
}
export {
    getChatMembers,
    getMessages,
    getMessageById,
    getChats,
    createMessage,
    updateMessage,
    deleteMessage,
    createPrivateChat,
    createGroupChat,
    getOrCreateInvitationLink,
    joinChatByInviteLink,
    updateGroupChat,
    deleteGroupChat,
    getChatMember,
    getChatById,
    getUserById,
    leaveChat,
    getChatParticipants,
    getLastChatMessage,
    kickFromChat,
    getChatIdByInviteLink,
    getChatByOtherUserId,
    clearMessages,
    blockUnblockUserInChat
}