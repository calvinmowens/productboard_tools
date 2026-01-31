import { useState, useEffect } from 'react';

// To set up Formspree:
// 1. Go to https://formspree.io and create a free account
// 2. Create a new form and get your form ID (e.g., "xyzabcde")
// 3. Replace the placeholder below with your form ID
const FORMSPREE_FORM_ID = 'meekbqln'; // Replace with your Formspree form ID

export default function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const closeModal = () => {
    setIsOpen(false);
    setStatus('idle');
  };

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim()) return;

    setStatus('submitting');

    try {
      const response = await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: feedback,
          name: name || undefined,
          email: email || undefined,
          _subject: 'Productboard Tools Feedback',
        }),
      });

      if (response.ok) {
        setStatus('success');
        setFeedback('');
        setName('');
        setEmail('');
        setTimeout(closeModal, 2000);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <>
      {/* Feedback Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-white text-gray-800 border-2 border-gray-800 hover:text-blue-600 hover:border-blue-600 px-4 py-2 rounded-lg shadow-lg transition-colors z-50"
      >
        Give Feedback
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Send Feedback</h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label htmlFor="feedback-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="feedback-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={status === 'submitting' || status === 'success'}
                  />
                </div>
                <div>
                  <label htmlFor="feedback-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="feedback-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={status === 'submitting' || status === 'success'}
                  />
                </div>
              </div>

              <label htmlFor="feedback-message" className="block text-sm font-medium text-gray-700 mb-1">
                Feedback <span className="text-red-500">*</span>
              </label>
              <textarea
                id="feedback-message"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Share your feedback, report bugs, or suggest improvements..."
                className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={status === 'submitting' || status === 'success'}
                required
              />

              {status === 'error' && (
                <p className="mt-2 text-sm text-red-600">
                  Failed to send feedback. Please try again.
                </p>
              )}

              {status === 'success' && (
                <p className="mt-2 text-sm text-green-600">
                  Thank you for your feedback!
                </p>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                  disabled={status === 'submitting'}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!feedback.trim() || status === 'submitting' || status === 'success'}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                >
                  {status === 'submitting' ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
