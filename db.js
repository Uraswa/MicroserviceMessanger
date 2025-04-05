const {Pool} = require('pg');

const pool = new Pool({
    user: 'nice',
    host: 'localhost',
    database: 'postgres',
    password: 'nice',
    port: 5432,
});

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
            `INSERT INTO chat (chat_name, is_ls)
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
            `INSERT INTO chat (chat_name, is_ls)
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
        SELECT link FROM chat_invite_link
        WHERE chat_id = $1 and user_id = $2
    `, [chatId, creatorId]);

    if (queryGet.rows) {
        return queryGet.rows[0].link;
    }

    let link = "abracadarba";

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
             `DELETE FROM chat_member WHERE user_id = $1 and chat_id = $2 RETURNING *`, [userId, chatId]
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
             FROM chat
             WHERE chat_id = $1
               AND is_ls = false RETURNING *`,
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
            `UPDATE
                 FROM chat
             SET (chat_name)
             VALUES ($2)
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

async function getUserProfile(userId) {
    const query = `
        SELECT u.user_id,
               u.nickname,
               up.description,
               up.birth_date
        FROM users u
                 LEFT JOIN user_profiles up ON u.user_id = up.user_id
        WHERE u.user_id = $1`;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
}

async function updateUserProfile(userId, {description, birthDate}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existsResult = await client.query(
            `SELECT 1
             FROM user_profiles
             WHERE user_id = $1`,
            [userId]
        );

        let result;
        if (existsResult.rows.length > 0) {


            result = await client.query(
                `UPDATE user_profiles
                 SET description = $1,
                     birth_date  = $2
                 WHERE user_id = $3 RETURNING *`,
                [description, birthDate, userId]
            );
        } else {
            // Insert new
            result = await client.query(
                `INSERT INTO user_profiles (user_id, description, birth_date)
                 VALUES ($1, $2, $3) RETURNING *`,
                [userId, description, birthDate]
            );
        }

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getChats(userId, filters = {}) {
    let query = `
        SELECT c.chat_id,
               c.chat_name,
               c.is_ls,
               COUNT(m.message_id) as message_count,
               MAX(m.timestamp)    as last_message_time
        FROM chat c
                 JOIN chat_member cm ON c.chat_id = cm.chat_id
                 LEFT JOIN messages m ON c.chat_id = m.chat_id
        WHERE cm.user_id = $1`;

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

    query += ` GROUP BY c.chat_id ORDER BY last_message_time DESC NULLS LAST`;

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

async function isUserChatMember(chat_id, user_id) {

}

async function getUserById(user_id) {

}

module.exports = {
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
    getUserProfile,
    updateUserProfile,
    getChatMember: isUserChatMember,
    getChatById,
    getUserById,
    leaveChat

}