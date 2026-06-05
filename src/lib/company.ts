export type CompanyLine =
  | { kind: "text"; value: string }
  | { kind: "data"; value: string };

export type CompanyNote = {
  title: string;
  lines: CompanyLine[];
};
