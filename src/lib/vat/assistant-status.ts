export function toolStatusLabel(name: string, args: Record<string, unknown>): string {
  const pattern = args.pattern ? String(args.pattern) : "";

  switch (name) {
    case "search_filing_data":
      return pattern ? `Searching bank for “${pattern}”…` : "Searching bank & documents…";
    case "get_recovery_opportunities":
      return "Scanning bank for recoverable VAT…";
    case "exclude_bank_lines_matching":
      return pattern ? `Excluding “${pattern}” bank lines…` : "Excluding bank lines…";
    case "confirm_bank_lines_matching":
      return pattern ? `Applying VAT treatment for “${pattern}”…` : "Confirming bank line treatment…";
    case "exclude_documents_matching":
      return pattern ? `Excluding “${pattern}” documents…` : "Excluding documents…";
    case "set_document_filing":
      return pattern ? `Updating “${pattern}” on invoices…` : "Updating document VAT cases…";
    case "apply_smart_defaults":
      return "Applying smart defaults…";
    case "refresh_elster_export":
      return "Recalculating ELSTER numbers…";
    default:
      return "Updating filing…";
  }
}
