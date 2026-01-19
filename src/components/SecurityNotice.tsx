interface SecurityNoticeProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays security information about how API tokens are handled.
 * Should be shown near the token input field in each module.
 */
export function SecurityNotice({ className = "" }: SecurityNoticeProps) {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm ${className}`}>
      <p className="font-medium text-blue-800 mb-2">Your API token is secure:</p>
      <ul className="text-blue-700 space-y-1 ml-4 list-disc">
        <li>Never stored on our servers or in your browser</li>
        <li>Never logged or persisted anywhere</li>
        <li>Only used for direct API calls during your session</li>
        <li>Automatically cleared after 30 minutes of inactivity</li>
      </ul>
    </div>
  );
}
