import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CheckoutForm } from "@/app/components/checkout-form";
export default async function CheckoutPage() { const session = await auth(); if (!session?.user) redirect("/giris?callbackUrl=/checkout"); return <CheckoutForm defaultName={`${session.user.name} ${session.user.surname}`} />; }
