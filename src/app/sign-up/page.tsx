import { redirect } from "next/navigation";

export const metadata = { title: "Create applicant account" };

export default function SignUp() {
  redirect("/applicant/sign-up");
}
