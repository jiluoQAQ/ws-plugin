import fetch, { FormData, Blob } from 'node-fetch'
import fs from 'fs'


function toQQNTMsg(self_id, data) {
    data = JSON.parse(data)
    switch (data.type) {
        case 'meta::connect':
            break
        case 'message::recv':
            makeMessage(self_id, data.payload[0])
            break
        default:
            break;
    }
}

function makeMessage(self_id, payload) {
    const e = {}
    e.bot = Bot[self_id]
    e.post_type = 'message'
    e.message_id = payload.msgId
    e.user_id = payload.senderUin
    e.time = payload.msgTime
    e.seq = payload.msgSeq
    e.rand = payload.msgRandom
    e.sender = {
        user_id: payload.senderUin,
        nickname: payload.senderNickName,
    }
    e.self_id = self_id
    e.message = []
    e.raw_message = ''
    for (const i of payload.elements) {
        switch (i.elementType) {
            case 1:
                if (i.textElement.atType == 2) {
                    e.message.push({ type: 'at', qq: i.textElement.atUid })
                    e.raw_message += `[提及：${i.textElement.atUid}]`
                } else if (i.textElement.atType == 1) {
                    e.message.push({ type: 'at', qq: 'all' })
                    e.raw_message += `[提及：全体成员]`
                } else if (i.textElement.atType == 0) {
                    e.message.push({ type: 'text', text: i.textElement.content })
                    e.raw_message += i.textElement.content
                }
                break;
            case 2:
                const md5 = i.picElement.md5HexStr.toUpperCase()
                e.message.push({
                    type: 'image',
                    url: `https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5}/0`
                })
                e.raw_message += `[图片: https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5}/0]`
                break
            case 3:
                e.message.push({
                    type: 'file',
                    name: i.fileElement.fileName,
                    fid: i.fileElement.fileUuid.replace('/', ''),
                    md5: i.fileElement.fileMd5,
                    size: i.fileElement.fileSize,
                })
                e.raw_message += `[文件: ${i.fileElement.fileName}]`
            case 4:
                e.message.push({
                    type: 'record',
                    file: i.pttElement.fileName,
                    md5: i.pttElement.md5HexStr,
                    size: i.pttElement.fileSize
                })
                e.raw_message += `[语音: ${i.pttElement.fileName}]`
                break
            case 5:
                e.message.push({
                    type: 'video',
                    name: i.videoElement.fileName,
                    fid: i.videoElement.fileUuid,
                    md5: i.videoElement.thumbMd5,
                    size: i.videoElement.thumbSize
                })
                e.raw_message += `[视频: ${i.videoElement.fileName}]`
                break
            case 6:
                e.message.push({ type: 'face', id: i.faceElement.faceIndex })
                e.raw_message += `[表情: ${i.faceElement.faceIndex}]`
                break
            case 7:
                e.message.push({ type: "reply", id: i.replyElement.sourceMsgIdInRecords })
                e.raw_message += `[回复：${i.replyElement.sourceMsgIdInRecords}]`
            default:
                break;
        }
    }
    if (payload.chatType == 2) {
        e.message_type = 'group'
        e.sub_type = 'normal'
        e.group_id = payload.peerUin
        e.group_name = payload.peerName
        logger.info(`${logger.blue(`[${e.self_id}]`)} 群消息：[${e.group_id}, ${e.user_id}] ${e.raw_message}`)
    } else if (payload.chatType == 1) {
        e.message_type = 'private'
        logger.info(`${logger.blue(`[${e.self_id}]`)} 好友消息：[${e.user_id}] ${e.raw_message}`)
    }
    Bot.em(`${e.post_type}.${e.message_type}`, e)
}

function pickFriend(self_id, user_id) {
    const i = {
        ...Bot[self_id].fl.get(user_id),
        self_id: self_id,
        bot: Bot[self_id],
        user_id: user_id,
    }
    return {
        ...i,
        sendMsg: msg => sendFriendMsg(i, msg),
    }
}

function pickMember(self_id, group_id, user_id) {
    const i = {
        ...Bot[self_id].fl.get(user_id),
        self_id: self_id,
        bot: Bot[self_id],
        group_id: group_id,
        user_id: user_id,
    }
    return {
        ...pickFriend(self_id, user_id),
        ...i,
    }
}

async function getMemberMap(self_id, group_id) {
    const bot = Bot[self_id]
    const body = {
        group: group_id,
        size: 9999
    }
    const memberList = await bot.api('POST', 'group/getMemberList', JSON.stringify(body)).then(async r => {
        if (r.status == 200) {
            return await r.json()
        } else {
            return []
        }
    })
    const map = new Map()
    for (const i of memberList) {
        map.set(i.detail.uin, {
            ...i.detail,
            card: i.detail.cardName || i.detail.nick,
            nickname: i.detail.nick,
            group_id,
            user_id: i.detail.uin
        })
    }
    return map
}

function pickGroup(self_id, group_id) {
    const i = {
        ...Bot[self_id].gl.get(group_id),
        self_id: self_id,
        bot: Bot[self_id],
        group_id: group_id,
    }
    return {
        ...i,
        sendMsg: async msg => await sendGroupMsg(i, msg),
        pickMember: user_id => pickMember(self_id, group_id, user_id),
        getMemberMap: async () => await getMemberMap(self_id, group_id),
    }
}

async function sendGroupMsg(data, msg) {
    const { msg: elements, log } = await makeMsg(data, msg)
    logger.info(`${logger.blue(`[${data.self_id} => ${data.group_id}]`)} 发送群消息：${log}`)
    data.bot.send('message::send', {
        peer: {
            chatType: 2,
            peerUin: data.group_id
        },
        elements
    })
    return { message_id: Date.now() }
}

async function sendFriendMsg(data, msg) {
    const { msg: elements, log } = await makeMsg(data, msg)
    logger.info(`${logger.blue(`[${data.self_id} => ${data.user_id}]`)} 发送好友消息：${log}`)
    data.bot.send('message::send', {
        peer: {
            chatType: 1,
            peerUin: data.user_id
        },
        elements
    })
    return { message_id: Date.now() }
}

async function makeMsg(data, msg) {
    if (!Array.isArray(msg))
        msg = [msg]
    const msgs = []
    let log = ''
    for (let i of msg) {
        if (typeof i != "object")
            i = { type: "text", text: i }

        switch (i.type) {
            case "text":
                log += i.text
                i = [{
                    "elementType": 1,
                    "textElement": {
                        "content": i.text
                    }
                }]
                break
            case "image":
                const img = await makeImg(data, i.file)
                i = [img]
                log += `[图片: ${img.picElement.md5HexStr}]`
                break
            // case "record":
            //     break
            // case "video":
            //     break
            // case "file":
            //     break
            case "at":
                log += `[提及: ${i.qq}]`
                i = [{
                    "elementType": 1,
                    "textElement": {
                        // "content": "@时空猫猫",
                        "atType": 2,
                        "atNtUin": i.qq
                    }
                }]
                break
            // case "reply":
            //     i = [{
            //         "elementType": 7,
            //         "replyElement": {
            //             "replayMsgSeq": "",
            //             "sourceMsgIdInRecords": i.id,
            //             "senderUid": ""
            //         }
            //     },]
            //     break
            case "node":
                const array = []
                for (const { message } of i.data) {
                    const { msg: node } = awaitmakeMsg(data, message)
                    array.push(...node)
                }
                i = array
                break
            default:
                i = []
            // i = { type: "text", data: JSON.stringify(i) }
        }
        msgs.push(...i)
    }
    return { msg: msgs, log }
}

async function makeImg(data, msg) {
    let buffer
    let contentType = 'image/png'
    if (msg.match(/^base64:\/\//)) {
        buffer = Buffer.from(msg.replace(/^base64:\/\//, ""), 'base64')
    } else if (msg.startsWith('http')) {
        const img = await fetch(msg)
        contentType = img.headers.get('content-type');
        const arrayBuffer = await img.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
    } else if (msg.startsWith('file:///')) {
        buffer = fs.readFileSync(msg.replace('file:///', ''))
        contentType = 'image/' + msg.substring(msg.lastIndexOf('.') + 1)
    }
    const blob = new Blob([buffer], { type: contentType })
    const formData = new FormData()
    formData.append('file', blob, 'ws-plugin.' + contentType.split('/')[1])
    const file = await data.bot.api('POST', 'upload', formData).then(r => r.json())
    return {
        elementType: 2,
        picElement: {
            md5HexStr: file.md5,
            fileSize: file.fileSize,
            picHeight: file.imageInfo.height,
            picWidth: file.imageInfo.width,
            fileName: file.md5 + '.' + file.ntFilePath.substring(file.ntFilePath.lastIndexOf('.') + 1),
            sourcePath: file.ntFilePath,
            picType: file.imageInfo.type === 'gif' ? 2000 : 1000
        }
    }
}

const qqnt = {
    toQQNTMsg,
    pickFriend,
    pickGroup,
    pickMember
}

export default qqnt 