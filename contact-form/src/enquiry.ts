// schema.sql holds the same lengths, so a row written straight to the table
// past this check still cannot be longer.
export const limits = {
  name: 200,
  email: 320,
  message: 5000,
};

export type Field = keyof typeof limits;

export const fields = Object.keys(limits) as Field[];

export type Enquiry = Record<Field, string>;

export type Errors = Partial<Record<Field, string>>;

export type Submission = { enquiry: Enquiry } | { errors: Errors; values: Partial<Enquiry> };

const labels: Record<Field, string> = {
  name: "your name",
  email: "your email address",
  message: "a message",
};

export function readEnquiry(submitted: Record<string, unknown>): Submission {
  const values: Partial<Enquiry> = {};
  const errors: Errors = {};

  for (const field of fields) {
    const raw = submitted[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    values[field] = value;

    if (value === "") {
      errors[field] = `Enter ${labels[field]}.`;
    } else if (value.length > limits[field]) {
      errors[field] = `Keep ${labels[field]} to ${limits[field]} characters.`;
    } else if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field] = "Enter an email address like name@example.com.";
    }
  }

  if (Object.keys(errors).length > 0) return { errors, values };
  return { enquiry: values as Enquiry };
}
