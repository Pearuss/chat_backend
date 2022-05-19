const formidable = require("formidable");
const fs = require("fs");
const path = require("path");
const Chat = require("../models/Chat.model");
const Message = require("../models/Message.model");
const File = require("../models/File.model");
const xss = require("xss");
const moment = require("moment");
exports.getChatList = async (req, res) => {
  try {
    const chats = await Chat.aggregate([
      {
        $match: {
          $or: [
            {
              u1: req.user._id,
            },
            {
              u2: req.user._id,
            },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          let: { u1: "$u1" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$u1"] } } },
            { $project: { password: 0, socketId: 0 } },
          ],
          as: "user1",
        },
      },
      {
        $lookup: {
          from: "users",
          let: { u2: "$u2" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$u2"] } } },
            { $project: { password: 0, socketId: 0 } },
          ],
          as: "user2",
        },
      },
      {
        $lookup: {
          from: "messages",

          let: { chatId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$chatId", "$$chatId"] } } },
            { $sort: { _id: -1 } },
            { $limit: 1 },
          ],
          as: "messages",
        },
      },
      {
        $sort: {
          lastMessage: -1,
        },
      },
    ]);
    res.json(chats);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ msg: "An unexpected error has occurred" });
  }
};

exports.getChat = async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const skip = 300 * (page - 1);
    const chatId = req.params.id;
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).send();
    }
    const messages = await Message.find({ chatId })
      .sort({ _id: -1 })
      .limit(300)
      .skip(skip)
      .populate("fileId")
      .populate("replyToId");

    res.json(messages.reverse());
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ msg: "An unexpected error has occurred" });
  }
};

exports.sendFile = async (req, res) => {
  try {
    const form = formidable();
    form.parse(req, async (err, fields, files) => {
      console.log(files);
      if (err) {
        throw err;
      }

      const to = req.params.id;
      let chat = await Chat.findOne({
        $or: [
          {
            $and: [
              {
                u1: req.user._id,
              },
              {
                u2: to,
              },
            ],
          },
          {
            $and: [
              {
                u1: to,
              },
              {
                u2: req.user._id,
              },
            ],
          },
        ],
      });
      if (!chat) {
        chat = new Chat({ u1: from, u2: to });
        await chat.save();
      }
      if (chat) {
        const spl = files.uploadedFile.originalFilename.split(".");
        const file = new File({
          size: files.uploadedFile.size,
          originalFilename: files.uploadedFile.originalFilename,
        });
        file.fileName = `${file._id}.${spl[spl.length - 1]}`;

        const message = new Message({
          from: req.user._id,
          chatId: chat._id,
          msgType: "file",
          fileId: file._id,
          content: "File",
        });

        chat.lastMessage = moment();

        await Promise.all([file.save(), message.save(), chat.save()]);
        const oldPath = files.uploadedFile.filepath;
        const newPath = path.join(
          __dirname,
          `../public/files/${file._id}.${spl[spl.length - 1]}`
        );
        fs.renameSync(oldPath, newPath);

        const newMessage = await Message.findById(message._id)
          .populate("fileId")
          .populate("replyToId");
        req.socketCon.to(chat.u1.toString()).emit("newMessages", newMessage);
        req.socketCon.to(chat.u2.toString()).emit("newMessages", newMessage);
      }
      res.json({ fields, files });
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ msg: "An unexpected error has occurred" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { data } = req.body;
    const to = req.params.id;
    const from = req.user._id;
    if (!from) {
      return;
    }
    if (data.content) {
      if (data.content.length > 1000) {
        req.socketCon
          .to(from)
          .emit(
            "receiveMessage",
            "The maximum message length is 1000 characters"
          );
        return;
      }
      data.content = xss(data.content);
    }

    let chat = await Chat.findOne({
      $or: [
        {
          $and: [
            {
              u1: from,
            },
            {
              u2: to,
            },
          ],
        },
        {
          $and: [
            {
              u1: to,
            },
            {
              u2: from,
            },
          ],
        },
      ],
    });
    if (!chat) {
      chat = new Chat({ u1: from, u2: to });
    }
    chat.lastMessage = moment();
    await chat.save();
    const message = new Message({ chatId: chat._id, from, ...data });
    await message.save();
    const responseMessage = await Message.findById(message._id).populate(
      "replyToId"
    );
    req.socketCon.to(chat.u1.toString()).emit("newMessages", responseMessage);
    req.socketCon.to(chat.u2.toString()).emit("newMessages", responseMessage);
    if (message.msgType === "call") {
      if (chat.u2.toString() === req.user._id.toString()) {
        req.socketCon
          .to(chat.u1.toString())
          .emit("callReceived", message.id, req.user.name);
      } else {
        req.socketCon
          .to(chat.u2.toString())
          .emit("callReceived", message.id, req.user.name);
      }
    }
    res.json({ id: message._id });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ msg: "An unexpected error has occurred" });
  }
};

exports.getFriend = async (req, res) => {
  const msg = await Message.findById(req.params.msgId);
  const chat = await Chat.findById(msg.chatId);
  if (chat.u1.toString() === req.user._id.toString()) {
    return res.json({ id: chat.u2.toString() });
  } else {
    return res.json({ id: chat.u1.toString() });
  }
};
exports.deleteMessage = async (req, res) => {
  await Message.deleteOne({ _id: req.params.msgId });

  res.json({ message: 200 });
};
