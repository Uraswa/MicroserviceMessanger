export default function (row) {
    return {
        chat_id: row.chat_id,
        chat_name: row.chat_name,
        is_ls: row.is_ls,
        created_time: row.created_time
    }
}