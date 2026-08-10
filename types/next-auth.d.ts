import { UserRole } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    surname: string;
    role: UserRole;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      surname: string;
      email: string;
      role: UserRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    surname?: string;
    role?: UserRole;
  }
}
