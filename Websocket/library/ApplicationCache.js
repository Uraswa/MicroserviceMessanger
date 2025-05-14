import redis from "redis";
import InnerCommunicationService from "../../services/innerCommunicationService.js";

class ApplicationCache {
    cache;
    reconnect_timeout = null;

    async init() {
        this.cache = await redis.createClient()
            .on("error", (err) => {
                this._tryReconnect();
            })
            .on("end", (err) => {
                this._tryReconnect();
            })
            .connect();

        if (this.reconnect_timeout != null) {
            clearTimeout(this.reconnect_timeout);
        }
    }

    _tryReconnect() {
        this.reconnect_timeout = setTimeout(() => {
            console.log("Trying to reconnect...")
            this.init();
        }, 5000)
    }

    async trySetChatMembers(chatId, members) {

        const lockKey = `lock_chat_${chatId}`;
        const dataKey = `chat_members_${chatId}`;

        let script = `
            if redis.call("GET", KEYS[1]) == "0" or redis.call("EXISTS", KEYS[1]) == 0 then 
                ${this._makeHSETLuaReq(members, "2")}
                return 1
            else
                return 0
            end
        `;
        let args = members.map(v => JSON.stringify(v))

        await this.cache.eval(script, {
            keys: [lockKey, dataKey],
            arguments: args
        })
    }

    _makeHSETLuaReq(members, set_key = "1") {
        return members.map((v, i, a) => `
                                    redis.call("HSET", KEYS[${set_key}], "${v['user_id']}", ARGV[${i + 1}])
                                `).join('\n') + '\n';
    }

    async updateChatMembers(chatId, updateOperation, maxRetries = 3, retryDelayMs = 100) {
        const lockKey = `lock_chat_${chatId}`;
        const dataKey = `chat_members_${chatId}`;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                //TODO что будет если запрос к бд займет дольше 10 сек?
                // Пытаемся получить блокировку (Lua-скрипт)
                const locked = await this.cache.eval(`
                if redis.call("GET", KEYS[1]) == "0" or redis.call("EXISTS", KEYS[1]) == 0 then
                    redis.call("SET", KEYS[1], "1", "EX", 30)
                    redis.call("DEL", KEYS[2])
                    return 1
                else
                    return 0
                end
            `, {
                    keys: [lockKey, dataKey],
                });

                if (locked === 1) {
                    try {
                        // 1. Сначала обновляем БД (источник истины)
                        let {members, success} = await updateOperation();

                        if (!success) return;

                        if (members.length > 0) {

                            // 2. Атомарно обновляем Redis и снимаем блокировку (Lua)

                            let script = `
                                ${this._makeHSETLuaReq(members)}
                                redis.call("DEL", KEYS[2])
                            `;
                            let args = members.map(v => JSON.stringify(v))

                            await this.cache.eval(script
                                , {
                                    keys: [dataKey, lockKey],
                                    arguments: args,
                                });
                        } else {
                            // нужно выполнить АВТОМАРНОЕ удаление
                            await this.cache.eval(`
                                redis.call("DEL", KEYS[1])
                                    redis.call("DEL", KEYS[2])
                                `, {
                                keys: [dataKey, lockKey]
                            });
                        }


                        return {success: true};
                    } catch (dbError) {
                        // Если ошибка в БД, снимаем блокировку и пробрасываем исключение
                        await this.cache.decr(lockKey);
                        throw dbError;
                    }
                } else {
                    // Блокировка занята — ждём и пробуем снова
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    retries++;
                }
            } catch (redisError) {
                console.error("Redis error:", redisError);
                retries++;
            }
        }

        throw new Error(`Не удалось обновить состав чата ${chatId} после ${maxRetries} попыток`);
    }

    async _getChatMemberViaHttp(chat_id, user_id) {
        let response = InnerCommunicationService.get('/api/getChatMember?chat_id=' + chat_id + "&user_id=" + user_id, 8000);
        if (response.status === 200 && response.data.success) {
            return response.data.data.member;
        }

        return false;
    }

    async _getChatMembersViaHttp(chat_id) {
        let response = InnerCommunicationService.get('/api/getChatMembers?chat_id=' + chat_id, 8000);
        if (response.status === 200 && response.data.success) {
            return response.data.data.members;
        }

        return [];
    }

    //force_http_if_not_found сделать запрос к апи, если ключ chat_members_key не представлен в кеше.
    async getChatMember(chat_id, user_id, force_http_if_not_found = true) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return null;
        }

        const chat_members_key = "chat_members_" + chat_id;

        try {

            let exists = await this.cache.exists(chat_members_key) !== 0

            if (force_http_if_not_found && !exists) {
                console.log("Chat members for " + chat_members_key + " are not present in cache. Making http request...");
                return await this._getChatMemberViaHttp(chat_id, user_id);
            }

            if (!exists) {
                return null;
            }


            const memberJson = await this.cache.hGet(chat_members_key, user_id.toString());
            if (memberJson) {
                return JSON.parse(memberJson);
            }

            return false;
        } catch (err) {
            console.error("Error in getChatMember:", err);
            return null;
        }
    }

    async getChatMembers(chat_id, force_http_if_not_found = true) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return null;
        }

        const chat_members_key = "chat_members_" + chat_id;

        try {

            let exists = await this.cache.exists(chat_members_key) !== 0;

            if (force_http_if_not_found && !exists) {
                console.log("Chat members for " + chat_members_key + " are not present in cache. Making http request...");
                return await this._getChatMembersViaHttp(chat_id);
            }

            if (!exists) {
                return null;
            }

            const members = await this.cache.hGetAll(chat_members_key);
            if (Object.keys(members).length > 0) {
                const result = [];
                for (const [userId, memberJson] of Object.entries(members)) {
                    result.push(JSON.parse(memberJson));
                }
                return result;
            }
            return [];
        } catch (err) {
            console.error("Error in getChatMembers:", err);
            return null;
        }
    }

    async setKey(key, value) {
        await this.cache.set(key, value);
    }

    async removeKey(key) {
        await this.cache.del(key);
    }

    async editKey(key, value) {
        await this.cache.set(key, value);
    }

    async getKey(key) {
        return await this.cache.get(key);
    }

    async getKeyJson(key) {
        let val = await this.getKey(key);
        if (!val) return val;
        return JSON.parse(val);
    }
}

const cache = new ApplicationCache();
await cache.init();
export default cache;