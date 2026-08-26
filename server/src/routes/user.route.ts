import { Router } from "express";
import userController from "../controllers/user.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();

router
    .route("/signup")
    .post(userController.signUp);

router
    .route("/signin")
    .post(userController.signIn);

router
    .route("verify-token")
    .get(userController.verifyEmail)
// secured routes

router.use(authMiddleware);

router
    .route("/")
    .get(userController.me);

router
    .route("/logout")
    .post(userController.logOut);

router
    .route("/token")
    .post(userController.refreshToken)

router
    .route("/password")
    .post(userController.changePassword);


export default router;