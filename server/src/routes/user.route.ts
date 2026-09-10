import { Router } from "express";
import userController from "../controllers/user.controller.ts";
import authMiddleware from "../middlewares/auth.middleware.ts";

const router = Router();

router.post("/signup", userController.signUp);
router.post("/signin", userController.signIn);
router.get("/verify-token", userController.verifyEmail);
router.post("/token", userController.refreshToken);

router.use(authMiddleware);

router.get("/", userController.me);
router.post("/logout", userController.logOut);
router.post("/password", userController.changePassword);

export default router;
