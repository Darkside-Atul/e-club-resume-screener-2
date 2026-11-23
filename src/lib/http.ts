export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}

export function databaseMessage(message?: string) {
  switch (message) {
    case "applications_closed": return "This project is no longer accepting applications.";
    case "profile_required": return "Add your name and student ID to your profile before applying.";
    case "upload_limit": return "You have reached the upload limit. Try again in an hour.";
    case "upload_expired": return "This upload expired. Select the PDF and try again.";
    case "questions_changed": return "The application questions changed. Refresh the page and try again.";
    case "answers_invalid": return "Answer each application question using up to 1,000 characters.";
    case "submission_changed": return "An application was submitted in another tab. Refresh before replacing it.";
    case "deadline_locked": return "You can extend the deadline after the first submission, but cannot shorten it.";
    case "project_closed": return "This project has closed and cannot reopen.";
    case "rubric_frozen": return "The rubric and questions are locked because a student has already applied.";
    default: return "We couldn’t save your changes. Try again.";
  }
}
