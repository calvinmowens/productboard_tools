import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { TimeoutWarningModal } from '../../components/TimeoutWarningModal';
import { SecurityNotice } from '../../components/SecurityNotice';
import ApiTokenHelpTooltip from '../../components/ApiTokenHelpTooltip';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type ImportStep = 'upload' | 'configure' | 'mapping' | 'preview' | 'importing' | 'duplicates' | 'results';

interface CSVRow {
  [key: string]: string;
}

interface FieldConfig {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  isCustomField?: boolean;
}

interface ColumnMapping {
  csvColumn: string;
  mappedTo: string | null; // null = ignore, or field key
}

interface ImportResult {
  rowIndex: number;
  name: string;
  success: boolean;
  entityId?: string;
  error?: string;
  ownerSkipped?: boolean;
  ownerEmail?: string;
}

interface DuplicateGroup {
  name: string;
  existingEntities: { id: string; name: string }[];
  newEntities: { rowIndex: number; name: string }[];
  action: 'create' | 'skip' | 'pending';
}

interface ParentEntity {
  id: string;
  name: string;
}

const ENTITY_TYPES = [
  { value: 'product', label: 'Product' },
  { value: 'component', label: 'Component' },
  { value: 'feature', label: 'Feature' },
  { value: 'subfeature', label: 'Subfeature' },
  { value: 'initiative', label: 'Initiative' },
  { value: 'objective', label: 'Objective' },
  { value: 'keyResult', label: 'Key Result' },
  { value: 'release', label: 'Release' },
  { value: 'releaseGroup', label: 'Release Group' },
];

const PARENT_TYPE_MAP: Record<string, string[]> = {
  product: [],
  component: ['product'],
  feature: ['product', 'component'],
  subfeature: ['feature'],
  initiative: [],
  objective: ['initiative'],
  keyResult: ['objective'],
  release: ['releaseGroup'],
  releaseGroup: [],
};

// Parse CSV string into rows
function parseCSV(csvText: string): { columns: string[]; rows: CSVRow[] } {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { columns: [], rows: [] };

  // Parse header
  const columns = parseCSVLine(lines[0]);

  // Parse rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: CSVRow = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    rows.push(row);
  }

  return { columns, rows };
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());

  return result;
}

// Format date value to ISO format (YYYY-MM-DD)
function formatDateValue(value: string): string {
  // If already in ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Try to parse common date formats
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    // Return in YYYY-MM-DD format
    return date.toISOString().split('T')[0];
  }

  // If parsing fails, return original value and let API handle validation
  return value;
}

// Download import log as CSV
function downloadImportLog(results: ImportResult[], entityType: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `import-log-${entityType}-${timestamp}.csv`;

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const ownerSkippedCount = results.filter(r => r.ownerSkipped).length;

  const headers = ['Row', 'Name', 'Status', 'Entity ID', 'Owner Skipped', 'Skipped Owner Email', 'Error'];
  const rows = results.map(r => [
    String(r.rowIndex + 1),
    escapeCSV(r.name),
    r.success ? 'Created' : 'Failed',
    r.entityId || '',
    r.ownerSkipped ? 'Yes' : '',
    r.ownerEmail || '',
    escapeCSV(r.error || '')
  ]);

  const summary = [
    ['CSV Entity Import Log'],
    [`Date: ${new Date().toLocaleString()}`],
    [`Entity Type: ${entityType}`],
    [`Total: ${results.length}`],
    [`Created: ${results.filter(r => r.success).length}`],
    [`Failed: ${results.filter(r => !r.success).length}`],
    [`Owner Skipped: ${ownerSkippedCount}`],
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

export default function CSVImport() {
  // Authentication state
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Step state
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');

  // CSV state
  const [csvData, setCsvData] = useState<{ columns: string[]; rows: CSVRow[] } | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configuration state
  const [entityType, setEntityType] = useState<string>('');
  const [parentType, setParentType] = useState<string>('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [availableParents, setAvailableParents] = useState<ParentEntity[]>([]);
  const [isLoadingParents, setIsLoadingParents] = useState(false);
  const [fieldConfig, setFieldConfig] = useState<FieldConfig[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Mapping state
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);

  // Import state
  const [_isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // Duplicate state
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);

  // Convex actions
  const validateApiKeyV2 = useAction(api.productboardV2.validateApiKeyV2);
  const getEntityConfiguration = useAction(api.productboardV2.getEntityConfiguration);
  const listEntities = useAction(api.productboardV2.listEntities);
  const createEntity = useAction(api.productboardV2.createEntity);
  const checkDuplicates = useAction(api.productboardV2.checkDuplicates);
  const deleteEntity = useAction(api.productboardV2.deleteEntity);

  const handleConnect = useCallback(async () => {
    if (!apiToken.trim()) return;

    setConnectionStatus('connecting');
    setConnectionError(null);

    try {
      const result = await validateApiKeyV2({ apiToken });

      if (!result.valid) {
        setConnectionStatus('error');
        setConnectionError(result.error || 'Invalid API key');
        return;
      }

      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError(String(error));
    }
  }, [apiToken, validateApiKeyV2]);

  const handleDisconnect = useCallback(() => {
    setApiToken('');
    setConnectionStatus('disconnected');
    setCsvData(null);
    setFileName('');
    setEntityType('');
    setParentType('');
    setSelectedParentId('');
    setAvailableParents([]);
    setFieldConfig([]);
    setColumnMappings([]);
    setImportResults([]);
    setDuplicateGroups([]);
    setCurrentStep('upload');
  }, []);

  // Inactivity timeout - clears token after 30 minutes of inactivity
  const { showWarning, timeRemaining, dismissWarning } = useInactivityTimeout(
    handleDisconnect,
    { enabled: connectionStatus === 'connected' }
  );

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setCsvData(parsed);

      // Initialize column mappings
      setColumnMappings(parsed.columns.map(col => ({
        csvColumn: col,
        mappedTo: null,
      })));
    };
    reader.readAsText(file);
  }, []);

  const handleEntityTypeChange = useCallback(async (type: string) => {
    setEntityType(type);
    setParentType('');
    setSelectedParentId('');
    setAvailableParents([]);
    setFieldConfig([]);

    if (!type) return;

    setIsLoadingConfig(true);
    try {
      const result = await getEntityConfiguration({ apiToken, entityType: type });

      if (result.success && result.data) {
        // Parse configuration to extract fields
        const fields: FieldConfig[] = [];

        // Standard fields (these are common across entity types)
        const standardFields = ['name', 'description', 'status', 'owner', 'timeframe'];

        if (result.data.fields) {
          for (const [key, config] of Object.entries(result.data.fields as Record<string, any>)) {
            const isCustom = !standardFields.includes(key) && key.startsWith('customField_');
            fields.push({
              key,
              label: config.label || config.name || key,
              type: config.schema || config.type || 'text',
              required: config.required || key === 'name',
              isCustomField: isCustom,
            });
          }
        }

        // If no fields returned, add default fields
        if (fields.length === 0) {
          fields.push(
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'richText' },
          );
        }

        setFieldConfig(fields);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      // Set default fields on error
      setFieldConfig([
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'richText' },
      ]);
    } finally {
      setIsLoadingConfig(false);
    }
  }, [apiToken, getEntityConfiguration]);

  const handleParentTypeChange = useCallback(async (type: string) => {
    setParentType(type);
    setSelectedParentId('');
    setAvailableParents([]);

    if (!type) return;

    setIsLoadingParents(true);
    try {
      // Fetch all entities of the parent type
      const allParents: ParentEntity[] = [];
      let pageToken: string | undefined;

      do {
        const result = await listEntities({
          apiToken,
          entityType: type,
          pageToken,
        });

        if (result.success && result.data) {
          for (const entity of result.data) {
            if (entity.fields?.name) {
              allParents.push({
                id: entity.id,
                name: entity.fields.name,
              });
            }
          }
          pageToken = result.nextPageToken || undefined;
        } else {
          break;
        }
      } while (pageToken);

      // Sort by name
      allParents.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableParents(allParents);
    } catch (error) {
      console.error('Error loading parents:', error);
      setAvailableParents([]);
    } finally {
      setIsLoadingParents(false);
    }
  }, [apiToken, listEntities]);

  const updateColumnMapping = useCallback((csvColumn: string, mappedTo: string | null) => {
    setColumnMappings(prev => prev.map(m =>
      m.csvColumn === csvColumn ? { ...m, mappedTo } : m
    ));
  }, []);

  const getNameColumn = useCallback(() => {
    return columnMappings.find(m => m.mappedTo === 'name')?.csvColumn || null;
  }, [columnMappings]);

  const canProceedToPreview = useCallback(() => {
    const hasNameMapping = columnMappings.some(m => m.mappedTo === 'name');
    // If parent type is selected, a parent must be selected from dropdown
    const hasParentIfNeeded = !parentType || selectedParentId;
    return hasNameMapping && hasParentIfNeeded;
  }, [columnMappings, parentType, selectedParentId]);

  const handlePreview = useCallback(() => {
    setCurrentStep('preview');
  }, []);

  const handleStartImport = useCallback(async () => {
    if (!csvData) return;

    setCurrentStep('importing');
    setIsImporting(true);
    setImportResults([]);

    const nameColumn = getNameColumn();

    if (!nameColumn) {
      setIsImporting(false);
      return;
    }

    // Use the selected parent ID directly (already validated via dropdown selection)
    const parentId = selectedParentId || undefined;

    const results: ImportResult[] = [];
    setImportProgress({ current: 0, total: csvData.rows.length });

    for (let i = 0; i < csvData.rows.length; i++) {
      const row = csvData.rows[i];
      const name = row[nameColumn];

      if (!name) {
        results.push({
          rowIndex: i,
          name: '(empty)',
          success: false,
          error: 'Name is required',
        });
        setImportProgress({ current: i + 1, total: csvData.rows.length });
        continue;
      }

      // Build fields object
      const fields: Record<string, any> = {};
      for (const mapping of columnMappings) {
        if (!mapping.mappedTo) continue;

        const value = row[mapping.csvColumn];
        if (value === undefined || value === '') continue;

        const fieldInfo = fieldConfig.find(f => f.key === mapping.mappedTo);
        const fieldKey = mapping.mappedTo;

        // Handle nested timeframe fields (timeframe.startDate, timeframe.endDate)
        if (fieldKey.startsWith('timeframe.')) {
          const timeframeProp = fieldKey.replace('timeframe.', '');
          if (!fields.timeframe) {
            fields.timeframe = { granularity: 'day' }; // Required attribute
          }
          // Format date value - ensure ISO format (YYYY-MM-DD)
          fields.timeframe[timeframeProp] = formatDateValue(value);
          continue;
        }

        // Format value based on field type (case-insensitive matching)
        const fieldType = fieldInfo?.type?.toLowerCase() || '';
        const fieldLabel = fieldInfo?.label?.toLowerCase() || '';

        if (fieldType.includes('status') || fieldKey === 'status') {
          fields[fieldKey] = { name: value };
        } else if (fieldType.includes('member') || fieldType.includes('user') || fieldKey === 'owner' || fieldLabel.includes('owner')) {
          fields[fieldKey] = { email: value.trim() };
        } else if (fieldType.includes('richtext') || fieldType.includes('rich_text') || fieldKey === 'description') {
          fields[fieldKey] = `<p>${value}</p>`;
        } else if (fieldType.includes('number') || fieldType.includes('integer') || fieldType.includes('float')) {
          fields[fieldKey] = parseFloat(value) || 0;
        } else if (fieldType.includes('date')) {
          fields[fieldKey] = formatDateValue(value);
        } else {
          // Note: Labels/Tags/MultiSelect fields are not supported via V2 API
          // as they require pre-existing select options
          fields[fieldKey] = value;
        }
      }

      // Track owner email if one was set (for reporting if skipped)
      const ownerEmail = fields.owner?.email;

      // Create entity with the single parent ID (same for all rows)
      try {
        let result = await createEntity({
          apiToken,
          entityType,
          fields,
          parentId,
        });

        // Check if the error is related to owner assignment (invalid member email)
        let ownerSkipped = false;
        if (!result.success && result.error && ownerEmail) {
          const errorLower = result.error.toLowerCase();
          const isOwnerError = errorLower.includes('owner') ||
            errorLower.includes('member') ||
            errorLower.includes('user') ||
            (errorLower.includes('email') && errorLower.includes('invalid'));

          if (isOwnerError) {
            // Retry without the owner field
            const fieldsWithoutOwner = { ...fields };
            delete fieldsWithoutOwner.owner;

            result = await createEntity({
              apiToken,
              entityType,
              fields: fieldsWithoutOwner,
              parentId,
            });

            if (result.success) {
              ownerSkipped = true;
            }
          }
        }

        results.push({
          rowIndex: i,
          name,
          success: result.success,
          entityId: result.entity?.id,
          error: result.error,
          ownerSkipped,
          ownerEmail: ownerSkipped ? ownerEmail : undefined,
        });
      } catch (error) {
        results.push({
          rowIndex: i,
          name,
          success: false,
          error: String(error),
        });
      }

      setImportProgress({ current: i + 1, total: csvData.rows.length });

      // Rate limiting delay
      if ((i + 1) % 10 === 0 && i + 1 < csvData.rows.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    setImportResults(results);
    setIsImporting(false);

    // Check for duplicates
    const createdNames = results.filter(r => r.success).map(r => r.name);
    if (createdNames.length > 0) {
      const dupResult = await checkDuplicates({
        apiToken,
        entityType,
        names: createdNames,
      });

      if (dupResult.success) {
        const groups: DuplicateGroup[] = [];
        for (const [name, existing] of Object.entries(dupResult.duplicates)) {
          if (existing.length > 1) {
            const newEntities = results
              .filter(r => r.success && r.name.toLowerCase() === name.toLowerCase())
              .map(r => ({ rowIndex: r.rowIndex, name: r.name }));

            groups.push({
              name,
              existingEntities: existing,
              newEntities,
              action: 'pending',
            });
          }
        }

        if (groups.length > 0) {
          setDuplicateGroups(groups);
          setCurrentStep('duplicates');
          return;
        }
      }
    }

    setCurrentStep('results');
  }, [csvData, entityType, selectedParentId, columnMappings, fieldConfig, apiToken, getNameColumn, createEntity, checkDuplicates]);

  const handleDuplicateAction = useCallback((name: string, action: 'create' | 'skip') => {
    setDuplicateGroups(prev => prev.map(g =>
      g.name.toLowerCase() === name.toLowerCase() ? { ...g, action } : g
    ));
  }, []);

  const handleSetAllDuplicates = useCallback((action: 'create' | 'skip') => {
    setDuplicateGroups(prev => prev.map(g => ({ ...g, action })));
  }, []);

  const handleResolveDuplicates = useCallback(async () => {
    setIsDeletingDuplicates(true);

    // Delete entities marked as 'skip' (keeping only the first one in each group)
    for (const group of duplicateGroups) {
      if (group.action === 'skip') {
        // Delete all but the first existing entity
        const toDelete = group.existingEntities.slice(1);
        for (const entity of toDelete) {
          await deleteEntity({ apiToken, entityId: entity.id });
        }
      }
    }

    setIsDeletingDuplicates(false);
    setCurrentStep('results');
  }, [duplicateGroups, apiToken, deleteEntity]);

  const validParentTypes = PARENT_TYPE_MAP[entityType] || [];
  const nameColumn = getNameColumn();

  const previewRows = csvData?.rows.slice(0, 10) || [];
  const successCount = importResults.filter(r => r.success).length;
  const failedCount = importResults.filter(r => !r.success).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block">
            ← Back to Scripts
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">CSV Entity Import</h1>
          <p className="mt-2 text-gray-600">
            Import entities from a CSV file using the Productboard V2 API.
          </p>

          {/* API Endpoints Used */}
          <div className="mt-4 p-3 bg-gray-100 rounded-lg">
            <p className="text-xs font-medium text-gray-700 mb-2">API Endpoints Used (V2):</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /v2/entities/configurations/:type</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/v2.0.0/reference/getentityconfiguration" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">GET /v2/entities</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/v2.0.0/reference/listentities" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">POST /v2/entities</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/v2.0.0/reference/createentity" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
              <li>
                <code className="bg-gray-200 px-1 rounded">DELETE /v2/entities/:id</code>
                {' '}-{' '}
                <a href="https://developer.productboard.com/v2.0.0/reference/deleteentity" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Docs</a>
              </li>
            </ul>
          </div>
        </div>

        {/* API Key Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Authentication</h2>
          <ApiTokenHelpTooltip />
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
                ? 'Connected to V2 API'
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

        {/* Step 1: Upload CSV */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'upload' && csvData ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">1</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Upload CSV</h2>
              </div>
              {currentStep !== 'upload' && csvData && (
                <button
                  onClick={() => setCurrentStep('upload')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'upload' ? (
              // Active state - show full upload UI
              !csvData ? (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Click to upload
                  </button>
                  <span className="text-gray-500"> or drag and drop a CSV file</span>
                </div>
              ) : (
                <div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-green-800 font-medium">{fileName}</p>
                        <p className="text-green-600 text-sm">
                          {csvData.columns.length} columns, {csvData.rows.length} rows
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setCsvData(null);
                          setFileName('');
                          setColumnMappings([]);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Change file
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Detected Columns:</p>
                    <div className="flex flex-wrap gap-2">
                      {csvData.columns.map(col => (
                        <span key={col} className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setCurrentStep('configure')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Configuration
                    </button>
                  </div>
                </div>
              )
            ) : csvData ? (
              // Completed state - show summary
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{fileName}</span>
                <span>•</span>
                <span>{csvData.columns.length} columns</span>
                <span>•</span>
                <span>{csvData.rows.length} rows</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 2: Configure Entity Type */}
        {connectionStatus === 'connected' && csvData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'configure' && entityType ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">2</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Configure Import</h2>
              </div>
              {currentStep !== 'configure' && entityType && (
                <button
                  onClick={() => setCurrentStep('configure')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'configure' ? (
              <div className="space-y-6">
                {/* Entity Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Entity Type to Import
                  </label>
                  <select
                    value={entityType}
                    onChange={(e) => handleEntityTypeChange(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select entity type...</option>
                    {ENTITY_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                {/* Parent Type Selection */}
                {entityType && validParentTypes.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Parent Entity Type (Optional)
                    </label>
                    <select
                      value={parentType}
                      onChange={(e) => handleParentTypeChange(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">No parent (top-level)</option>
                      {validParentTypes.map(type => {
                        const typeInfo = ENTITY_TYPES.find(t => t.value === type);
                        return (
                          <option key={type} value={type}>{typeInfo?.label || type}</option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {/* Parent Selection Dropdown */}
                {entityType && parentType && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Parent {ENTITY_TYPES.find(t => t.value === parentType)?.label}
                    </label>
                    {isLoadingParents ? (
                      <div className="text-sm text-gray-500 py-2">Loading available parents...</div>
                    ) : availableParents.length === 0 ? (
                      <div className="text-sm text-orange-600 py-2">
                        No {parentType} entities found. Create one first or select a different parent type.
                      </div>
                    ) : (
                      <select
                        value={selectedParentId}
                        onChange={(e) => setSelectedParentId(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Select a parent...</option>
                        {availableParents.map(parent => (
                          <option key={parent.id} value={parent.id}>{parent.name}</option>
                        ))}
                      </select>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      All imported entities will be created under this parent.
                    </p>
                  </div>
                )}

                {/* Loading indicator */}
                {isLoadingConfig && (
                  <div className="text-sm text-gray-500">Loading field configuration...</div>
                )}

                {/* Available Fields */}
                {fieldConfig.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Available Fields:</p>
                    <div className="flex flex-wrap gap-2">
                      {fieldConfig.map(field => (
                        <span
                          key={field.key}
                          className={`px-2 py-1 rounded text-sm ${
                            field.required
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {field.label}
                          {field.required && ' *'}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      <span className="text-blue-600">Blue</span> = Required
                    </p>
                  </div>
                )}

                {entityType && fieldConfig.length > 0 && (
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => setCurrentStep('upload')}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setCurrentStep('mapping')}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Continue to Column Mapping
                    </button>
                  </div>
                )}
              </div>
            ) : entityType ? (
              // Completed state - show summary
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{ENTITY_TYPES.find(t => t.value === entityType)?.label}</span>
                {parentType && selectedParentId && (
                  <>
                    <span>•</span>
                    <span>Parent: {availableParents.find(p => p.id === selectedParentId)?.name}</span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Step 3: Column Mapping */}
        {connectionStatus === 'connected' && csvData && entityType && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {currentStep !== 'mapping' && currentStep !== 'configure' && nameColumn ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">3</span>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Map Columns</h2>
              </div>
              {currentStep !== 'mapping' && currentStep !== 'configure' && nameColumn && (
                <button
                  onClick={() => setCurrentStep('mapping')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
            </div>

            {currentStep === 'mapping' ? (
              <>
                <p className="text-sm text-gray-600 mb-6">
                  Map each CSV column to a Productboard field, or choose to ignore it.
                </p>

                {/* Column headers */}
                <div className="flex items-center gap-4 px-3 py-2 mb-2">
                  <div className="w-1/3">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">CSV Column</span>
                  </div>
                  <div className="w-8"></div>
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Productboard Field</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {columnMappings.slice(0, 10).map(mapping => {
                    // Sort fields: name first, description second, then alphabetically
                    const sortedStandardFields = [...fieldConfig.filter(f => !f.isCustomField)].sort((a, b) => {
                      if (a.key === 'name') return -1;
                      if (b.key === 'name') return 1;
                      if (a.key === 'description') return -1;
                      if (b.key === 'description') return 1;
                      return a.label.localeCompare(b.label);
                    });
                    const sortedCustomFields = [...fieldConfig.filter(f => f.isCustomField)].sort((a, b) =>
                      a.label.localeCompare(b.label)
                    );

                    return (
                      <div key={mapping.csvColumn} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                        <div className="w-1/3">
                          <span className="font-medium text-gray-900">{mapping.csvColumn}</span>
                          <p className="text-xs text-gray-500 truncate">
                            e.g., "{csvData.rows[0]?.[mapping.csvColumn]?.substring(0, 30) || ''}"
                          </p>
                        </div>
                        <div className="text-gray-400">→</div>
                        <div className="flex-1">
                          <select
                            value={mapping.mappedTo || ''}
                            onChange={(e) => updateColumnMapping(mapping.csvColumn, e.target.value || null)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Ignore this column</option>
                            <optgroup label="Standard Fields">
                              {sortedStandardFields.map(field => (
                                <option key={field.key} value={field.key}>
                                  {field.label} {field.required ? '*' : ''}
                                </option>
                              ))}
                            </optgroup>
                            {sortedCustomFields.length > 0 && (
                              <optgroup label="Custom Fields">
                                {sortedCustomFields.map(field => (
                                  <option key={field.key} value={field.key}>{field.label}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {columnMappings.length > 10 && (
                  <p className="mt-3 text-sm text-gray-500">
                    Showing first 10 of {columnMappings.length} columns. Remaining columns will be ignored.
                  </p>
                )}

                {/* Validation */}
                <div className="mt-6 space-y-2">
                  {!nameColumn && (
                    <div className="text-sm text-red-600">
                      You must map a column to "Name" (required field)
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-between items-center">
                  <button
                    onClick={() => setCurrentStep('configure')}
                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCurrentStep('upload')}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePreview}
                      disabled={!canProceedToPreview()}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    >
                      Preview Import
                    </button>
                  </div>
                </div>
              </>
            ) : currentStep !== 'configure' && nameColumn ? (
              // Completed state - show summary
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{columnMappings.filter(m => m.mappedTo).length} fields mapped</span>
                <span>•</span>
                <span>{columnMappings.filter(m => m.mappedTo).map(m => {
                  const field = fieldConfig.find(f => f.key === m.mappedTo);
                  return field?.label || m.mappedTo;
                }).join(', ')}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Step 4: Preview */}
        {connectionStatus === 'connected' && currentStep === 'preview' && csvData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-sm font-medium">4</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Preview Import</h2>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">{csvData.rows.length}</div>
                <div className="text-sm text-blue-600">Total Rows</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">
                  {csvData.rows.filter(row => nameColumn && row[nameColumn]).length}
                </div>
                <div className="text-sm text-green-600">With Name</div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-orange-700">
                  {csvData.rows.filter(row => !nameColumn || !row[nameColumn]).length}
                </div>
                <div className="text-sm text-orange-600">Missing Name</div>
              </div>
            </div>

            {/* Import Summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-medium text-gray-900 mb-2">Import Summary</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>Entity Type: <span className="font-medium">{ENTITY_TYPES.find(t => t.value === entityType)?.label}</span></li>
                {parentType && selectedParentId && (
                  <li>
                    Parent: <span className="font-medium">{availableParents.find(p => p.id === selectedParentId)?.name}</span>
                    <span className="text-gray-400"> ({ENTITY_TYPES.find(t => t.value === parentType)?.label})</span>
                  </li>
                )}
                <li>
                  Mapped Fields:{' '}
                  <span className="font-medium">
                    {columnMappings.filter(m => m.mappedTo).map(m => {
                      const field = fieldConfig.find(f => f.key === m.mappedTo);
                      return field?.label || m.mappedTo;
                    }).join(', ')}
                  </span>
                </li>
              </ul>
            </div>

            {/* Sample Preview */}
            <div className="mb-6">
              <h3 className="font-medium text-gray-900 mb-2">
                Sample Preview (First 10 rows)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">#</th>
                      {columnMappings.filter(m => m.mappedTo).map(m => (
                        <th key={m.csvColumn} className="px-4 py-2 text-left font-medium text-gray-700">
                          {fieldConfig.find(f => f.key === m.mappedTo)?.label || m.mappedTo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className={!row[nameColumn || ''] ? 'bg-red-50' : ''}>
                        <td className="px-4 py-2 text-gray-500">{idx + 1}</td>
                        {columnMappings.filter(m => m.mappedTo).map(m => (
                          <td key={m.csvColumn} className="px-4 py-2 text-gray-900 truncate max-w-xs">
                            {row[m.csvColumn] || <span className="text-gray-400 italic">(empty)</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvData.rows.length > 10 && (
                <p className="text-sm text-gray-500 mt-2">
                  ...and {csvData.rows.length - 10} more rows not shown.
                </p>
              )}
            </div>

            <div className="flex justify-between items-center">
              <button
                onClick={() => setCurrentStep('mapping')}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep('upload')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartImport}
                  className="px-8 py-3 bg-green-600 text-white text-lg font-medium rounded-lg hover:bg-green-700 transition-colors"
                >
                  Start Import ({csvData.rows.filter(row => nameColumn && row[nameColumn]).length} entities)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Importing */}
        {connectionStatus === 'connected' && currentStep === 'importing' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center animate-pulse">
                <span className="text-white text-sm font-medium">5</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Importing...</h2>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Creating entities...</span>
                <span>{importProgress.current} / {importProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Duplicate Review */}
        {connectionStatus === 'connected' && currentStep === 'duplicates' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-sm font-medium">6</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Review Duplicates</h2>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              The following entities may be duplicates. Choose to keep all or review individually.
            </p>

            {/* Bulk Actions */}
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => handleSetAllDuplicates('create')}
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
              >
                Keep All Duplicates
              </button>
              <button
                onClick={() => handleSetAllDuplicates('skip')}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
              >
                Delete All Duplicates
              </button>
            </div>

            {/* Duplicate Groups */}
            <div className="space-y-4 max-h-[500px] overflow-y-auto">
              {duplicateGroups.map((group) => (
                <div key={group.name} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      "{group.name}" ({group.existingEntities.length} entities)
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDuplicateAction(group.name, 'create')}
                        className={`px-3 py-1 text-xs rounded ${
                          group.action === 'create'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-green-100'
                        }`}
                      >
                        Keep All
                      </button>
                      <button
                        onClick={() => handleDuplicateAction(group.name, 'skip')}
                        className={`px-3 py-1 text-xs rounded ${
                          group.action === 'skip'
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-red-100'
                        }`}
                      >
                        Delete Duplicates
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {group.existingEntities.map((entity, idx) => (
                      <div
                        key={entity.id}
                        className={`px-4 py-2 text-sm ${
                          idx === 0 ? 'bg-green-50' : group.action === 'skip' ? 'bg-red-50' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded ${
                              idx === 0
                                ? 'bg-green-200 text-green-800'
                                : group.action === 'skip'
                                ? 'bg-red-200 text-red-800'
                                : 'bg-gray-200 text-gray-600'
                            }`}
                          >
                            {idx === 0 ? 'KEEP' : group.action === 'skip' ? 'DELETE' : 'PENDING'}
                          </span>
                          <span className="text-gray-900">{entity.name}</span>
                          <span className="text-xs text-gray-500">({entity.id})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={() => setCurrentStep('results')}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Skip (Keep All)
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep('results')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveDuplicates}
                  disabled={isDeletingDuplicates || duplicateGroups.some(g => g.action === 'pending')}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                >
                  {isDeletingDuplicates ? 'Processing...' : 'Apply Decisions'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 7: Results */}
        {connectionStatus === 'connected' && currentStep === 'results' && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Import Complete</h2>
            </div>

            <div className={`grid gap-4 mb-6 ${importResults.some(r => r.ownerSkipped) ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{successCount}</div>
                <div className="text-sm text-green-600">Successfully Created</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{failedCount}</div>
                <div className="text-sm text-red-600">Failed</div>
              </div>
              {importResults.some(r => r.ownerSkipped) && (
                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-orange-700">{importResults.filter(r => r.ownerSkipped).length}</div>
                  <div className="text-sm text-orange-600">Owner Skipped</div>
                </div>
              )}
            </div>

            {failedCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-red-800 mb-2">Failed Imports:</h3>
                <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                  {importResults
                    .filter(r => !r.success)
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1} ({r.name}): {r.error}
                      </li>
                    ))}
                  {importResults.filter(r => !r.success).length > 20 && (
                    <li>...and {importResults.filter(r => !r.success).length - 20} more errors</li>
                  )}
                </ul>
              </div>
            )}

            {importResults.some(r => r.ownerSkipped) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-orange-800 mb-2">
                  Owner Assignment Skipped ({importResults.filter(r => r.ownerSkipped).length} entities):
                </h3>
                <p className="text-sm text-orange-700 mb-2">
                  The following entities were created without an owner because the specified email is not an active member in this workspace:
                </p>
                <ul className="text-sm text-orange-700 space-y-1 max-h-40 overflow-y-auto">
                  {importResults
                    .filter(r => r.ownerSkipped)
                    .slice(0, 20)
                    .map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1} ({r.name}): Owner "{r.ownerEmail}" skipped
                      </li>
                    ))}
                  {importResults.filter(r => r.ownerSkipped).length > 20 && (
                    <li>...and {importResults.filter(r => r.ownerSkipped).length - 20} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => downloadImportLog(importResults, entityType)}
                className="px-6 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                Download Log
              </button>
              <button
                onClick={() => {
                  setCsvData(null);
                  setFileName('');
                  setEntityType('');
                  setParentType('');
                  setSelectedParentId('');
                  setAvailableParents([]);
                  setFieldConfig([]);
                  setColumnMappings([]);
                  setImportResults([]);
                  setDuplicateGroups([]);
                  setCurrentStep('upload');
                }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Import Another CSV
              </button>
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
