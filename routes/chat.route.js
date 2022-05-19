const express = require("express");
const router = express.Router();

const chatController = require("../controllers/chat.controller");

router.get("/", chatController.getChatList);
router.get("/:id", chatController.getChat);
router.post("/:id/file", chatController.sendFile);
router.post("/:id", chatController.sendMessage);
router.get("/friend/:msgId", chatController.getFriend);
router.delete("/message/:msgId", chatController.deleteMessage);
// router.post(
//   "/forgot-password",
//   authValidation.forgotPassword(),
//   authController.forgotPassword
// );
// router.post(
//   "/reset-password",
//   authValidation.resetPassword(),
//   authController.resetPassword
// );
// router.post("/active", authController.active);
module.exports = router;
