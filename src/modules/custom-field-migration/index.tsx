import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { CustomField, Feature, PreviewItem, FieldMapping, ConnectionStatus, MigrationResult } from '../../types';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { TimeoutWarningModal } from '../../components/TimeoutWarningModal';
import { SecurityNotice } from '../../components/SecurityNotice';

// Helper to display field values properly
function formatFieldValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    if (value.name) {
      return value.name;
    }
    if (Array.isArray(value)) {
      return value.map(v => v?.name || String(v)).join(', ');
    }
    if (value.label) {
      return value.label;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

// Helper to download migration log as CSV
function downloadMigrationLog(results: MigrationResult[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `migration-log-${timestamp}.csv`;

  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? formatFieldValue(value) : String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = ['Feature ID', 'Feature Name', 'Source Field', 'Target Field', 'New Value', 'Status', 'Response', 'Error'];

  const rows = results.map(r => [
    r.featureId,
    escapeCSV(r.featureName),
    escapeCSV(r.sourceFieldName),
    escapeCSV(r.targetFieldName),
    escapeCSV(r.newValue),
    r.success ? 'Success' : 'Failed',
    escapeCSV(r.response),
    escapeCSV(r.error)
  ]);

  const summary = [
    ['Migration Log'],
    [`Date: ${new Date().toLocaleString()}`],
    [`Total: ${results.length}`],
    [`Successful: ${results.filter(r => r.success).length}`],
    [`Failed: ${results.filter(r => !r.success).length}`],
    [''],
    headers,
    ...rows
  ];

  const csvContent = summary.map(row =>
    Array.isArray(row) ? row.join(',') : row
  ).join('\n');

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

// Generate unique ID for mappings
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export default function CustomFieldMigration() {
  // Authentication state
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Custom fields state
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Field mappings - array of source/target pairs
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([
    { id: generateId(), sourceFieldId: '', targetFieldId: '' }
  ]);

  // Options state
  const [onlyEmptyTargets, setOnlyEmptyTargets] = useState(true);

  // Preview/execution state
  const [_features, setFeatures] = useState<Feature[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState({ current: 0, total: 0 });
  const [executionResults, setExecutionResults] = useState<MigrationResult[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Convex actions
  const validateApiKey = useAction(api.productboard.validateApiKey);
  const listCustomFields = useAction(api.productboard.listCustomFields);
  const listFeatures = useAction(api.productboard.listFeatures);
  const setCustomFieldValue = useAction(api.productboard.setCustomFieldValue);
  const getBatchCustomFieldValues = useAction(api.productboard.getBatchCustomFieldValues);

  const handleConnect = useCallback(async () => {
    if (!apiToken.trim()) return;

    setConnectionStatus('connecting');
    setConnectionError(null);

    try {
      const validation = await validateApiKey({ apiToken });

      if (!validation.valid) {
        setConnectionStatus('error');
        setConnectionError(validation.error || 'Invalid API key');
        return;
      }

      const fieldsResult = await listCustomFields({ apiToken });

      if (!fieldsResult.success) {
        setConnectionStatus('error');
        setConnectionError(fieldsResult.error || 'Failed to fetch custom fields');
        return;
      }

      setCustomFields(fieldsResult.data);
      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, validateApiKey, listCustomFields]);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setCustomFields([]);
    setFieldMappings([{ id: generateId(), sourceFieldId: '', targetFieldId: '' }]);
    setPreviewItems([]);
    setFeatures([]);
    setExecutionResults([]);
  }, []);

  // Inactivity timeout - clears token after 30 minutes of inactivity
  const { showWarning, timeRemaining, dismissWarning } = useInactivityTimeout(
    handleDisconnect,
    { enabled: connectionStatus === 'connected' }
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fieldsResult = await listCustomFields({ apiToken });
      if (fieldsResult.success) {
        setCustomFields(fieldsResult.data);
      }
    } catch (error) {
      console.error('Error refreshing custom fields:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [apiToken, listCustomFields]);

  const addMapping = useCallback(() => {
    setFieldMappings(prev => [...prev, { id: generateId(), sourceFieldId: '', targetFieldId: '' }]);
    setPreviewItems([]);
  }, []);

  const removeMapping = useCallback((id: string) => {
    setFieldMappings(prev => prev.length > 1 ? prev.filter(m => m.id !== id) : prev);
    setPreviewItems([]);
  }, []);

  const updateMapping = useCallback((id: string, field: 'sourceFieldId' | 'targetFieldId', value: string) => {
    setFieldMappings(prev => prev.map(m => {
      if (m.id !== id) return m;
      if (field === 'sourceFieldId') {
        return { ...m, sourceFieldId: value, targetFieldId: '' };
      }
      return { ...m, [field]: value };
    }));
    setPreviewItems([]);
  }, []);

  const loadAllFeatures = useCallback(async (): Promise<Feature[]> => {
    const allFeatures: Feature[] = [];
    let nextPage: string | null = null;

    do {
      const result = await listFeatures({ apiToken, pageToken: nextPage || undefined });
      if (!result.success) break;
      allFeatures.push(...result.data);
      nextPage = result.nextPage;
    } while (nextPage);

    return allFeatures;
  }, [apiToken, listFeatures]);

  const validMappings = fieldMappings.filter(m => m.sourceFieldId && m.targetFieldId);

  const handleLoadPreview = useCallback(async () => {
    if (validMappings.length === 0) return;

    setIsLoadingPreview(true);
    setPreviewItems([]);

    try {
      const allFeatures = await loadAllFeatures();
      setFeatures(allFeatures);

      if (allFeatures.length === 0) {
        setIsLoadingPreview(false);
        return;
      }

      const featureIds = allFeatures.map(f => f.id);
      const allItems: PreviewItem[] = [];

      // Process each mapping
      for (const mapping of validMappings) {
        const sourceField = customFields.find(f => f.id === mapping.sourceFieldId);
        const targetField = customFields.find(f => f.id === mapping.targetFieldId);

        const [sourceValues, targetValues] = await Promise.all([
          getBatchCustomFieldValues({ apiToken, customFieldId: mapping.sourceFieldId, featureIds }),
          getBatchCustomFieldValues({ apiToken, customFieldId: mapping.targetFieldId, featureIds }),
        ]);

        for (const feature of allFeatures) {
          const sourceData = sourceValues.results[feature.id] || { value: null, hasValue: false };
          const targetData = targetValues.results[feature.id] || { value: null, hasValue: false };

          let action: PreviewItem['action'];
          if (!sourceData.hasValue) {
            action = 'skipped_source_empty';
          } else if (onlyEmptyTargets && targetData.hasValue) {
            action = 'skipped_has_value';
          } else {
            action = 'will_update';
          }

          allItems.push({
            featureId: feature.id,
            featureName: feature.name,
            sourceFieldId: mapping.sourceFieldId,
            sourceFieldName: sourceField?.name || '',
            targetFieldId: mapping.targetFieldId,
            targetFieldName: targetField?.name || '',
            sourceValue: sourceData.value,
            targetValue: targetData.value,
            action,
          });
        }
      }

      setPreviewItems(allItems);
    } catch (error) {
      console.error('Error loading preview:', error);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [validMappings, apiToken, onlyEmptyTargets, loadAllFeatures, getBatchCustomFieldValues, customFields]);

  const handleExecuteMigration = useCallback(async () => {
    setShowConfirmModal(false);
    setIsExecuting(true);
    setExecutionResults([]);

    const itemsToUpdate = previewItems.filter(item => item.action === 'will_update');
    const results: MigrationResult[] = [];

    setExecutionProgress({ current: 0, total: itemsToUpdate.length });

    for (let i = 0; i < itemsToUpdate.length; i++) {
      const item = itemsToUpdate[i];
      const targetField = customFields.find(f => f.id === item.targetFieldId);
      const fieldType = targetField?.type || 'text';

      try {
        const result = await setCustomFieldValue({
          apiToken,
          customFieldId: item.targetFieldId,
          featureId: item.featureId,
          value: item.sourceValue,
          fieldType,
        });

        results.push({
          featureId: item.featureId,
          featureName: item.featureName,
          sourceFieldName: item.sourceFieldName,
          targetFieldName: item.targetFieldName,
          success: result.success,
          action: 'updated',
          newValue: item.sourceValue,
          response: result.response || '',
          error: result.error,
        });
      } catch (error) {
        results.push({
          featureId: item.featureId,
          featureName: item.featureName,
          sourceFieldName: item.sourceFieldName,
          targetFieldName: item.targetFieldName,
          success: false,
          action: 'failed',
          newValue: item.sourceValue,
          response: '',
          error: String(error),
        });
      }

      setExecutionProgress({ current: results.length, total: itemsToUpdate.length });
    }

    setExecutionResults(results);
    setIsExecuting(false);
  }, [previewItems, customFields, apiToken, setCustomFieldValue]);

  const previewStats = {
    willUpdate: previewItems.filter(i => i.action === 'will_update').length,
    skippedHasValue: previewItems.filter(i => i.action === 'skipped_has_value').length,
    skippedSourceEmpty: previewItems.filter(i => i.action === 'skipped_source_empty').length,
  };

  const executionStats = {
    success: executionResults.filter(r => r.success).length,
    failed: executionResults.filter(r => !r.success).length,
  };

  // Get fields already used in other mappings (for a given mapping)
  const getUsedFieldIds = (currentMappingId: string) => {
    return fieldMappings
      .filter(m => m.id !== currentMappingId)
      .flatMap(m => [m.sourceFieldId, m.targetFieldId])
      .filter(Boolean);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            ← Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Custom Field Migration</h1>
          <p className="mt-2 text-gray-600">Migrate values between Productboard custom fields</p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used:</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /hierarchy-entities/custom-fields</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getcustomfields" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /features</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getfeatures" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /hierarchy-entities/custom-fields-values/value</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/getcustomfieldvalue" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">PUT /hierarchy-entities/custom-fields-values/value</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/reference/setcustomfieldvalue" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
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
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:bg-blue-50 disabled:text-blue-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Disconnect
                </button>
              </div>
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
                ? `Connected - ${customFields.length} custom fields found`
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

        {/* Field Mappings Section */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${validMappings.length > 0 ? 'bg-green-500' : 'bg-blue-500'}`}>
                {validMappings.length > 0 ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-white text-sm font-medium">2</span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Field Mappings</h2>
            </div>

            <div className="space-y-3">
              {fieldMappings.map((mapping, index) => {
                const sourceField = customFields.find(f => f.id === mapping.sourceFieldId);
                const usedFieldIds = getUsedFieldIds(mapping.id);

                return (
                  <div key={mapping.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm font-medium text-gray-700">Mapping {index + 1}</span>
                      {fieldMappings.length > 1 && (
                        <button
                          onClick={() => removeMapping(mapping.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Source Field */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Source Field (copy FROM)
                        </label>
                        <select
                          value={mapping.sourceFieldId}
                          onChange={(e) => updateMapping(mapping.id, 'sourceFieldId', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Select a field...</option>
                          {customFields.map((field) => (
                            <option
                              key={field.id}
                              value={field.id}
                              disabled={usedFieldIds.includes(field.id)}
                            >
                              {field.name} ({field.type})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Target Field */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Target Field (copy TO)
                        </label>
                        <select
                          value={mapping.targetFieldId}
                          onChange={(e) => updateMapping(mapping.id, 'targetFieldId', e.target.value)}
                          disabled={!mapping.sourceFieldId}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        >
                          <option value="">
                            {mapping.sourceFieldId ? 'Select a field...' : 'Select source first...'}
                          </option>
                          {customFields
                            .filter((field) =>
                              sourceField &&
                              field.type === sourceField.type &&
                              field.id !== mapping.sourceFieldId &&
                              !usedFieldIds.includes(field.id)
                            )
                            .map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.name} ({field.type})
                              </option>
                            ))}
                        </select>
                        {sourceField && (
                          <p className="mt-1 text-xs text-gray-500">
                            Only showing {sourceField.type} fields
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={addMapping}
                className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                + Add Mapping
              </button>
            </div>

            {/* Options */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyEmptyTargets}
                  onChange={(e) => {
                    setOnlyEmptyTargets(e.target.checked);
                    setPreviewItems([]);
                  }}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="font-medium text-gray-900">Preserve existing values (don't overwrite)</span>
                  <p className="text-sm text-gray-500 mt-1">
                    When enabled, target fields that already have data will be skipped.
                    Only empty target fields will be updated with values from the source field.
                  </p>
                </div>
              </label>
            </div>

            {/* Load Preview Button */}
            {validMappings.length > 0 && (
              <button
                onClick={handleLoadPreview}
                disabled={isLoadingPreview}
                className={`mt-6 px-6 py-2 rounded-lg transition-colors ${
                  previewItems.length > 0
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400'
                    : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300'
                } disabled:cursor-not-allowed`}
              >
                {isLoadingPreview ? 'Loading Preview...' : previewItems.length > 0 ? 'Reload Preview' : 'Load Preview'}
              </button>
            )}
          </div>
        )}

        {/* Preview Section */}
        {previewItems.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
            </div>

            {/* Stats */}
            <div className={`grid gap-4 mb-6 ${onlyEmptyTargets ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{previewStats.willUpdate}</div>
                <div className="text-sm text-green-600">Will Update</div>
              </div>
              {onlyEmptyTargets && (
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-700">{previewStats.skippedHasValue}</div>
                  <div className="text-sm text-yellow-600">Skipped (has value)</div>
                </div>
              )}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-gray-700">{previewStats.skippedSourceEmpty}</div>
                <div className="text-sm text-gray-600">Skipped (source empty)</div>
              </div>
            </div>

            {/* Preview Table */}
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Feature</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mapping</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {previewItems.slice(0, 100).map((item, idx) => (
                    <tr key={`${item.featureId}-${item.targetFieldId}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate" title={item.featureName}>
                        {item.featureName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <span className="text-xs">{item.sourceFieldName} → {item.targetFieldName}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.sourceValue !== null && item.sourceValue !== undefined ? formatFieldValue(item.sourceValue) : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.targetValue !== null && item.targetValue !== undefined ? formatFieldValue(item.targetValue) : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {item.action === 'will_update' && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">Will Update</span>
                        )}
                        {item.action === 'skipped_has_value' && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">Skipped</span>
                        )}
                        {item.action === 'skipped_source_empty' && (
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">No Source</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {previewItems.length > 100 && (
              <p className="mt-2 text-sm text-gray-500">
                Showing first 100 of {previewItems.length} items
              </p>
            )}
          </div>
        )}

        {/* Execute Section */}
        {connectionStatus === 'connected' && validMappings.length > 0 && previewItems.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${executionResults.length > 0 ? 'bg-green-500' : 'bg-blue-500'}`}>
                {executionResults.length > 0 ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-white text-sm font-medium">4</span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Execute Migration</h2>
            </div>

            {isExecuting ? (
              <div>
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Processing...</span>
                    <span>{executionProgress.current} / {executionProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(executionProgress.current / executionProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : executionResults.length > 0 ? (
              <div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-700">{executionStats.success}</div>
                    <div className="text-sm text-green-600">Successful</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-red-700">{executionStats.failed}</div>
                    <div className="text-sm text-red-600">Failed</div>
                  </div>
                </div>

                {executionStats.failed > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-medium text-red-800 mb-2">Failed Updates:</h3>
                    <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                      {executionResults
                        .filter(r => !r.success)
                        .map((r, idx) => (
                          <li key={`${r.featureId}-${idx}`}>
                            {r.featureName} ({r.sourceFieldName} → {r.targetFieldName}): {r.error}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => downloadMigrationLog(executionResults)}
                    className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    Download Log
                  </button>
                  <button
                    onClick={() => {
                      setExecutionResults([]);
                      setPreviewItems([]);
                    }}
                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Start New Migration
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Execute Button */}
                {previewStats.willUpdate > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-4">
                      Ready to migrate {previewStats.willUpdate} items across {validMappings.length} mapping(s).
                    </p>

                    <button
                      onClick={() => setShowConfirmModal(true)}
                      className="px-8 py-3 bg-blue-600 text-white text-lg font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Execute Migration
                    </button>
                  </div>
                )}

                {/* Preview loaded but no items to update */}
                {previewStats.willUpdate === 0 && (
                  <p className="text-sm text-gray-600">
                    No items to migrate. All items are either skipped (target has value) or have no source value.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Migration</h3>
              <p className="text-gray-600 mb-4">
                You are about to migrate <strong>{previewStats.willUpdate}</strong> items across <strong>{validMappings.length}</strong> mapping(s):
              </p>
              <ul className="text-sm text-gray-600 mb-4 space-y-1">
                {validMappings.map((m, idx) => {
                  const source = customFields.find(f => f.id === m.sourceFieldId);
                  const target = customFields.find(f => f.id === m.targetFieldId);
                  return (
                    <li key={m.id}>
                      {idx + 1}. {source?.name} → {target?.name}
                    </li>
                  );
                })}
              </ul>
              <p className="text-gray-600 mb-6">
                This action cannot be easily undone. Are you sure you want to proceed?
              </p>
              <div className="flex gap-4 justify-end">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteMigration}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Yes, Execute Migration
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
