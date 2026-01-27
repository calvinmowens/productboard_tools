import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { TimeoutWarningModal } from '../../components/TimeoutWarningModal';
import { SecurityNotice } from '../../components/SecurityNotice';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface Note {
  id: string;
  title?: string;
  content?: string;
  company?: { id: string };
  createdAt?: string;
  source?: { origin?: string };
}

interface Company {
  id: string;
  name: string;
}

interface DuplicateGroup {
  key: string;
  notes: Note[];
  keepNote: Note;
  deleteNotes: Note[];
}

interface DeletionResult {
  noteId: string;
  title: string;
  companyName: string;
  success: boolean;
  error?: string;
}

// Find duplicate notes based on content + title + company
function findDuplicateGroups(notes: Note[]): DuplicateGroup[] {
  // Group notes by (content, title, companyId)
  const groupsWithCompany = new Map<string, Note[]>();
  const groupsWithoutCompany = new Map<string, Note[]>();

  for (const note of notes) {
    const content = (note.content || '').trim();
    const title = (note.title || '').trim();
    const companyId = note.company?.id || null;

    if (companyId) {
      const key = `${content}|||${title}|||${companyId}`;
      const group = groupsWithCompany.get(key) || [];
      group.push(note);
      groupsWithCompany.set(key, group);
    } else {
      const key = `${content}|||${title}`;
      const group = groupsWithoutCompany.get(key) || [];
      group.push(note);
      groupsWithoutCompany.set(key, group);
    }
  }

  // Merge notes without company into groups with matching content+title
  const duplicatesMap = new Map<string, Note[]>();

  // Add all groups with company
  for (const [key, group] of groupsWithCompany) {
    duplicatesMap.set(key, [...group]);
  }

  // Merge groups without company
  for (const [keyNoCompany, groupNoCompany] of groupsWithoutCompany) {
    const [content, title] = keyNoCompany.split('|||');

    // Find matching keys with company
    const matchingKeys = Array.from(duplicatesMap.keys()).filter(k => {
      const [c, t] = k.split('|||');
      return c === content && t === title;
    });

    if (matchingKeys.length > 0) {
      // Merge into existing groups
      for (const matchKey of matchingKeys) {
        const existing = duplicatesMap.get(matchKey) || [];
        existing.push(...groupNoCompany);
        duplicatesMap.set(matchKey, existing);
      }
    } else {
      // Create new group with null company
      const key = `${content}|||${title}|||null`;
      duplicatesMap.set(key, [...groupNoCompany]);
    }
  }

  // Filter to only groups with actual duplicates and determine keep/delete
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [key, notes] of duplicatesMap) {
    const uniqueIds = new Set(notes.map(n => n.id));
    if (notes.length > 1 && uniqueIds.size > 1) {
      // Sort by createdAt (oldest first)
      const sorted = [...notes].sort((a, b) => {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        return dateA.localeCompare(dateB);
      });

      // Keep oldest with company, or oldest if none have company
      const withCompany = sorted.filter(n => n.company?.id);
      const keepNote = withCompany.length > 0 ? withCompany[0] : sorted[0];
      const deleteNotes = sorted.filter(n => n.id !== keepNote.id);

      duplicateGroups.push({
        key,
        notes: sorted,
        keepNote,
        deleteNotes,
      });
    }
  }

  return duplicateGroups;
}

// Download deletion log as CSV
function downloadDeletionLog(results: DeletionResult[], totalGroups: number) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `duplicate-notes-deletion-log-${timestamp}.csv`;

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const headers = ['Note ID', 'Title', 'Company', 'Status', 'Error'];

  const rows = results.map(r => [
    r.noteId,
    escapeCSV(r.title),
    escapeCSV(r.companyName),
    r.success ? 'Deleted' : 'Failed',
    escapeCSV(r.error || '')
  ]);

  const summary = [
    ['Duplicate Notes Deletion Log'],
    [`Date: ${new Date().toLocaleString()}`],
    [`Duplicate Groups Found: ${totalGroups}`],
    [`Notes Deleted: ${results.filter(r => r.success).length}`],
    [`Failed: ${results.filter(r => !r.success).length}`],
    [''],
    headers,
    ...rows
  ];

  const csvContent = summary.map(row => row.join(',')).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function DuplicateNotes() {
  // Authentication state
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Data state
  const [notes, setNotes] = useState<Note[]>([]);
  const [companies, setCompanies] = useState<Map<string, Company>>(new Map());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);

  // Loading state
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ notes: 0, companies: 0 });

  // Execution state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState({ current: 0, total: 0 });
  const [deletionResults, setDeletionResults] = useState<DeletionResult[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Convex actions
  const listNotes = useAction(api.productboard.listNotes);
  const listCompanies = useAction(api.productboard.listCompanies);
  const deleteNoteAction = useAction(api.productboard.deleteNote);

  const handleConnect = useCallback(async () => {
    if (!apiToken.trim()) return;

    setConnectionStatus('connecting');
    setConnectionError(null);

    try {
      // Try to fetch notes to validate the API key
      const result = await listNotes({ apiToken });

      if (!result.success) {
        setConnectionStatus('error');
        setConnectionError(result.error || 'Invalid API key');
        return;
      }

      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, listNotes]);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setNotes([]);
    setCompanies(new Map());
    setDuplicateGroups([]);
    setDeletionResults([]);
    setLoadingProgress({ notes: 0, companies: 0 });
  }, []);

  // Inactivity timeout - clears token after 30 minutes of inactivity
  const { showWarning, timeRemaining, dismissWarning } = useInactivityTimeout(
    handleDisconnect,
    { enabled: connectionStatus === 'connected' }
  );

  const handleLoadNotes = useCallback(async () => {
    setIsLoadingNotes(true);
    setDuplicateGroups([]);
    setDeletionResults([]);
    setLoadingProgress({ notes: 0, companies: 0 });

    try {
      // Load all notes
      const allNotes: Note[] = [];
      let nextCursor: string | null = null;

      do {
        const result = await listNotes({ apiToken, pageCursor: nextCursor || undefined });
        if (!result.success) break;
        allNotes.push(...result.data);
        setLoadingProgress(prev => ({ ...prev, notes: allNotes.length }));
        nextCursor = result.nextCursor;
      } while (nextCursor);

      setNotes(allNotes);

      // Load all companies
      const allCompanies: Company[] = [];
      let nextUrl: string | null = null;

      do {
        const result = await listCompanies({ apiToken, nextUrl: nextUrl || undefined });
        if (!result.success) break;
        allCompanies.push(...result.data);
        setLoadingProgress(prev => ({ ...prev, companies: allCompanies.length }));
        nextUrl = result.nextUrl;
      } while (nextUrl);

      const companyMap = new Map<string, Company>();
      for (const company of allCompanies) {
        companyMap.set(company.id, company);
      }
      setCompanies(companyMap);

      // Find duplicates
      const groups = findDuplicateGroups(allNotes);
      setDuplicateGroups(groups);

    } catch (error) {
      console.error('Error loading notes:', error);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [apiToken, listNotes, listCompanies]);

  const handleDeleteDuplicates = useCallback(async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);
    setDeletionResults([]);

    const notesToDelete = duplicateGroups.flatMap(g => g.deleteNotes);
    const results: DeletionResult[] = [];

    setDeletionProgress({ current: 0, total: notesToDelete.length });

    for (let i = 0; i < notesToDelete.length; i++) {
      const note = notesToDelete[i];
      const companyName = note.company?.id ? companies.get(note.company.id)?.name || '' : '';

      try {
        const result = await deleteNoteAction({ apiToken, noteId: note.id });

        results.push({
          noteId: note.id,
          title: note.title || '',
          companyName,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        results.push({
          noteId: note.id,
          title: note.title || '',
          companyName,
          success: false,
          error: String(error),
        });
      }

      setDeletionProgress({ current: results.length, total: notesToDelete.length });

      // Small delay to avoid rate limiting
      if ((i + 1) % 50 === 0 && i + 1 < notesToDelete.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setDeletionResults(results);
    setIsDeleting(false);
  }, [duplicateGroups, companies, apiToken, deleteNoteAction]);

  const getCompanyName = (companyId: string | undefined) => {
    if (!companyId) return '(No company)';
    return companies.get(companyId)?.name || companyId;
  };

  const totalNotesToDelete = duplicateGroups.reduce((sum, g) => sum + g.deleteNotes.length, 0);

  const deletionStats = {
    success: deletionResults.filter(r => r.success).length,
    failed: deletionResults.filter(r => !r.success).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            ← Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Delete Duplicate Notes</h1>
          <p className="mt-2 text-gray-600">
            Find and delete duplicate notes. Notes are considered duplicates if they have the same content, title, and company.
          </p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used:</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /notes</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getnotes" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /companies</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getcompanies" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">DELETE /notes/:id</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/deletenote-1" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
            </ul>
          </div>
        </div>

        {/* API Key Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-blue-500'}`}>
              {connectionStatus === 'connected' ? (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white text-sm font-medium">1</span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900">API Authentication</h2>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="apiToken" className="block text-sm font-medium text-gray-700 mb-1">
                Productboard API Token
              </label>
              <div className="relative">
                <input
                  id="apiToken"
                  type={showToken ? 'text' : 'password'}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && apiToken.trim() && connectionStatus !== 'connected' && connectionStatus !== 'connecting') {
                      handleConnect();
                    }
                  }}
                  disabled={connectionStatus === 'connected'}
                  placeholder="Enter your API token..."
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  className="w-full px-4 py-2 pr-16 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {connectionStatus === 'connected' ? (
              <button
                onClick={handleDisconnect}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!apiToken.trim() || connectionStatus === 'connecting'}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
              >
                {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          {/* Connection Status */}
          <div className="mt-4 flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : connectionStatus === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-300'
              }`}
            />
            <span className="text-sm text-gray-600">
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : connectionStatus === 'error'
                ? 'Connection failed'
                : 'Not connected'}
            </span>
          </div>

          {connectionError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {connectionError}
            </div>
          )}

          {connectionStatus !== 'connected' && (
            <SecurityNotice className="mt-4" />
          )}
        </div>

        {/* Load Notes Section */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${notes.length > 0 ? 'bg-green-500' : 'bg-blue-500'}`}>
                {notes.length > 0 ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-white text-sm font-medium">2</span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Load Notes</h2>
            </div>

            {isLoadingNotes ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Loading notes and companies...</p>
                <p className="text-sm text-gray-500">
                  Notes: {loadingProgress.notes} | Companies: {loadingProgress.companies}
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }} />
                </div>
              </div>
            ) : notes.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-700">{notes.length}</div>
                    <div className="text-sm text-blue-600">Total Notes</div>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-orange-700">{duplicateGroups.length}</div>
                    <div className="text-sm text-orange-600">Duplicate Groups</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-red-700">{totalNotesToDelete}</div>
                    <div className="text-sm text-red-600">Notes to Delete</div>
                  </div>
                </div>

                <button
                  onClick={handleLoadNotes}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                >
                  Reload Notes
                </button>
              </div>
            ) : (
              <button
                onClick={handleLoadNotes}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Load Notes
              </button>
            )}
          </div>
        )}

        {/* Preview Section */}
        {duplicateGroups.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Duplicate Groups Preview</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Showing {Math.min(duplicateGroups.length, 10)} of {duplicateGroups.length} duplicate groups.
              Green notes will be kept, red notes will be deleted.
            </p>

            <div className="space-y-4 max-h-[500px] overflow-y-auto">
              {duplicateGroups.slice(0, 10).map((group, groupIdx) => (
                <div key={group.key} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">
                    Group {groupIdx + 1} ({group.notes.length} notes)
                  </div>
                  <div className="divide-y divide-gray-100">
                    {group.notes.map((note) => {
                      const isKeep = note.id === group.keepNote.id;
                      return (
                        <div
                          key={note.id}
                          className={`px-4 py-3 ${
                            isKeep ? 'bg-green-50' : 'bg-red-50'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded ${
                                  isKeep
                                    ? 'bg-green-200 text-green-800'
                                    : 'bg-red-200 text-red-800'
                                }`}
                              >
                                {isKeep ? 'KEEP' : 'DELETE'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {note.createdAt ? new Date(note.createdAt).toLocaleString() : '(No date)'}
                              </span>
                            </div>
                            <div className="text-sm font-medium text-gray-900 text-left">
                              {note.title || '(No title)'}
                            </div>
                            <p className="text-xs text-gray-500 text-left truncate">
                              {note.content?.substring(0, 100) || '(No content)'}
                              {(note.content?.length || 0) > 100 ? '...' : ''}
                            </p>
                            <div className="text-xs text-gray-500 text-left">
                              <span>{getCompanyName(note.company?.id)}</span>
                              {note.source?.origin && (
                                <span className="ml-3">Source: {note.source.origin}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {duplicateGroups.length > 10 && (
              <p className="mt-4 text-sm text-gray-500">
                ...and {duplicateGroups.length - 10} more groups not shown.
              </p>
            )}
          </div>
        )}

        {/* Execute Section */}
        {duplicateGroups.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${deletionResults.length > 0 ? 'bg-green-500' : 'bg-blue-500'}`}>
                {deletionResults.length > 0 ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-white text-sm font-medium">4</span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Delete Duplicates</h2>
            </div>

            {isDeleting ? (
              <div>
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Deleting notes...</span>
                    <span>{deletionProgress.current} / {deletionProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-red-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(deletionProgress.current / deletionProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : deletionResults.length > 0 ? (
              <div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-700">{deletionStats.success}</div>
                    <div className="text-sm text-green-600">Successfully Deleted</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-red-700">{deletionStats.failed}</div>
                    <div className="text-sm text-red-600">Failed</div>
                  </div>
                </div>

                {deletionStats.failed > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-medium text-red-800 mb-2">Failed Deletions:</h3>
                    <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                      {deletionResults
                        .filter(r => !r.success)
                        .map((r) => (
                          <li key={r.noteId}>
                            {r.title || r.noteId}: {r.error}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => downloadDeletionLog(deletionResults, duplicateGroups.length)}
                    className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    Download Log
                  </button>
                  <button
                    onClick={() => {
                      setDeletionResults([]);
                      setDuplicateGroups([]);
                      setNotes([]);
                    }}
                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Delete Button */}
                {totalNotesToDelete > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-4">
                      Ready to delete {totalNotesToDelete} duplicate notes across {duplicateGroups.length} groups.
                    </p>

                    <button
                      onClick={() => setShowConfirmModal(true)}
                      className="px-8 py-3 bg-red-600 text-white text-lg font-medium rounded-lg hover:bg-red-700 transition-colors"
                    >
                      Delete Duplicates
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* No Duplicates Message */}
        {notes.length > 0 && duplicateGroups.length === 0 && !isLoadingNotes && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✨</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Duplicates Found</h3>
              <p className="text-gray-600">
                Great news! There are no duplicate notes in this workspace.
              </p>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Deletion</h3>
              <p className="text-gray-600 mb-6">
                You are about to permanently delete <strong>{totalNotesToDelete}</strong> duplicate notes.
                <br /><br />
                This action cannot be undone. Are you sure you want to proceed?
              </p>
              <div className="flex gap-4 justify-end">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteDuplicates}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Yes, Delete Notes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Timeout Warning Modal */}
        <TimeoutWarningModal
          isOpen={showWarning}
          timeRemaining={timeRemaining}
          onContinue={dismissWarning}
        />
      </div>
    </div>
  );
}
