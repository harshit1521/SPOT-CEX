import { z } from "zod"


const signUp = z.object({

    usesrname: z.string().trim().nonempty("Username is required !!"),
    email: z.email().trim(),
    password: z.string().min(6)
})

const signIn = z.object({

    email: z.email().trim(),
    password: z.string().min(6)
})

const password = z.object({

    oldPassword: z.string().min(6),
    newPassword: z.string().min(6)
})

export { signUp, signIn, password}