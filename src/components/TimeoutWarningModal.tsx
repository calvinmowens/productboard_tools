interface TimeoutWarningModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Time remaining in seconds */
  timeRemaining: number;
  /** Callback when user clicks "Continue Session" */
  onContinue: () => void;
}

/**
 * Modal that warns users their session will expire due to inactivity.
 * Displays countdown timer and allows users to continue their session.
 */
export function TimeoutWarningModal({ isOpen, timeRemaining, onContinue }: TimeoutWarningModalProps) {
  if (!isOpen) return null;

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, "0")}`
    : `${seconds} seconds`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Session Timeout Warning
        </h2>
        <p className="text-gray-600 mb-4">
          Your session will expire in <span className="font-semibold text-orange-600">{timeDisplay}</span> due to inactivity.
        </p>
        <p className="text-gray-600 mb-6">
          For security, your API token will be cleared and you will need to re-enter it to continue.
        </p>
        <div className="flex justify-end">
          <button
            onClick={onContinue}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Continue Session
          </button>
        </div>
      </div>
    </div>
  );
}
