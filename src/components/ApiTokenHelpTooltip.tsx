import { useState } from 'react';

export default function ApiTokenHelpTooltip() {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        className="ml-2 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-medium flex items-center justify-center transition-colors"
        aria-label="How to get API token"
      >
        i
      </button>

      {isVisible && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 text-left">
          <div className="text-sm text-gray-700 space-y-3">
            <div>
              <span className="font-semibold">Log In:</span> Open your preferred web browser and log into Productboard.
            </div>
            <div>
              <span className="font-semibold">Navigate to Token Generation:</span>
              <br />
              Go to Workspace Settings &gt; Integrations &gt; Public APIs &gt; Access Token.
              <p className="mt-1 text-xs text-gray-500">
                Note: If this section isn't visible, your account may be on the Essentials plan. Access to API tokens requires at least a Pro plan. Plan features and names are subject to change; refer to Productboard pricing for the latest information.
              </p>
            </div>
            <div>
              <span className="font-semibold">Generate Token:</span> Click on the + symbol to create a new token.
            </div>
          </div>
          <div className="absolute -top-2 left-4 w-3 h-3 bg-white border-l border-t border-gray-200 transform rotate-45"></div>
        </div>
      )}
    </div>
  );
}
