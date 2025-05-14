export default function (row) {
    return {
        user_id: row.user_id,
        is_blocked: row.is_blocked,
        is_chat_hidden: row.is_chat_hidden,
        is_admin: row.is_admin
    }
}