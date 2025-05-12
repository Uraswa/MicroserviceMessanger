import redis from "redis";
import InnerCommunicationService from "../../services/innerCommunicationService.js";

class ApplicationCache {
    cache;
    set_tries = 5;
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

    async clearChatMembersCache(chat_member_key) {
        console.log("Trying to clear up cache for " + chat_member_key);
        for (let i = 0; i < this.set_tries; i++) {
            try {
                const reply = await this.cache.del(chat_member_key);
                if (reply === 1) {
                    console.log("Cache for " + chat_member_key + " has been cleared");
                    return;
                }
            } catch (err) {
                console.log("Error! clearing cache for " + chat_member_key + " Retrying...")
            }
        }
        console.log("Cache clearing for " + chat_member_key + " failed!");
    }

    async addUserAsChatMember(chat_id, member, check_len) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return false;
        }

        const chat_members_key = "chat_members_" + chat_id;

        try {
            if (await this.cache.exists(chat_members_key) === 0) {
                console.log("Chat members for " + chat_members_key + " are not present in cache. Skipping....");
                return false;
            }

            const amountOfMembers = await this.cache.hLen(chat_members_key);

            if (amountOfMembers != check_len) {
                console.log(`Error! Amount of chat members in redis is not the same as in db. DB=${check_len}; REDIS=${amountOfMembers}`);
                await this.clearChatMembersCache(chat_members_key);
                return false;
            }

            const memberJson = JSON.stringify(member);

            for (let i = 0; i < this.set_tries; i++) {
                try {
                    const reply = await this.cache.hSet(chat_members_key, member.user_id.toString(), memberJson);
                    if (reply !== 0) {
                        console.log("Added new chat_member(" + memberJson + ") for " + chat_members_key);
                        return true;
                    }
                } catch (err) {
                    console.log("Error! Adding chat_member(" + memberJson + ") for " + chat_members_key + " failed. Retrying");
                }
            }

            console.log("Error adding user " + JSON.stringify(member) + " for " + chat_members_key + " chat member! Trying to destroy whole members list");
            await this.clearChatMembersCache(chat_members_key);
            return false;
        } catch (err) {
            console.error("Error in addUserAsChatMember:", err);
            return false;
        }
    }

    async editUserChatMember(chat_id, user_id, newMember) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return false;
        }

        const chat_members_key = "chat_members_" + chat_id;
        let existsHashmap = await this.cache.exists(chat_members_key) !== 0;

        if (!existsHashmap) {
            return;
        }

        const memberJson = JSON.stringify(newMember);

        try {
            for (let i = 0; i < this.set_tries; i++) {
                const exists = await this.cache.hExists(chat_members_key, user_id.toString());
                if (!exists) {
                    await this.clearChatMembersCache(chat_members_key);
                    console.log(`User ${user_id} not found in chat ${chat_id}`);
                    return false;
                }

                const reply = await this.cache.hSet(chat_members_key, user_id.toString(), memberJson);
                console.log(`Updated chat_member(${user_id}) for ${chat_members_key}`);
                return true;
            }

            console.log(`Error updating user ${user_id} for ${chat_members_key}! Clearing cache...`);
            await this.clearChatMembersCache(chat_members_key);
            return false;
        } catch (err) {
            console.error("Error in editUserChatMember:", err);
            return false;
        }
    }

    async addChatMembers(chat_id, members) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return false;
        }

        const chat_members_key = "chat_members_" + chat_id;

        try {
            // Создаем объект для массового добавления
            const membersData = {};
            members.forEach(member => {

                if (member.is_kicked) return;

                membersData[member.user_id.toString()] = JSON.stringify(member);
            });

            // Добавляем всех участников за одну операцию
            const reply = await this.cache.hSet(chat_members_key, membersData);

            if (reply === members.length) {
                console.log(`Added ${members.length} members to ${chat_members_key}`);
                return true;
            } else {
                console.log(`Error! Only ${reply} of ${members.length} members were added to ${chat_members_key}`);
                await this.clearChatMembersCache(chat_members_key);
                return false;
            }
        } catch (err) {
            console.error("Error in addChatMembers:", err);
            await this.clearChatMembersCache(chat_members_key);
            return false;
        }
    }

    async removeUserAsChatMember(chat_id, user_id) {
        if (!this.cache?.isReady) {
            console.log("Redis connection lost!");
            return false;
        }

        const chat_members_key = "chat_members_" + chat_id;

        try {
            for (let i = 0; i < this.set_tries; i++) {
                const reply = await this.cache.hDel(chat_members_key, user_id.toString());
                if (reply === 1) {
                    console.log(`Removed user ${user_id} from ${chat_members_key}`);
                    return true;
                } else if (reply === 0) {
                    console.log(`User ${user_id} not found in ${chat_members_key}`);
                    await this.clearChatMembersCache(chat_members_key);
                    return false;
                }
                console.log(`Error! Removing user ${user_id} from ${chat_members_key} failed. Retrying`);
            }

            console.log(`Error removing user ${user_id} from ${chat_members_key}! Clearing cache...`);
            await this.clearChatMembersCache(chat_members_key);
            return false;
        } catch (err) {
            console.error("Error in removeUserAsChatMember:", err);
            return false;
        }
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
}

const cache = new ApplicationCache();
await cache.init();
export default cache;