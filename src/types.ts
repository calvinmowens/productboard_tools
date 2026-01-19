export interface CustomField {
  id: string;
  name: string;
  type: 'number' | 'text' | 'dropdown' | 'date' | 'member' | 'members';
  description?: string;
}

export interface Feature {
  id: string;
  name: string;
  description?: string;
  status?: {
    name: string;
  };
}

export interface PreviewItem {
  featureId: string;
  featureName: string;
  sourceFieldId: string;
  sourceFieldName: string;
  targetFieldId: string;
  targetFieldName: string;
  sourceValue: any;
  targetValue: any;
  action: 'will_update' | 'skipped_has_value' | 'skipped_source_empty';
}

export interface FieldMapping {
  id: string;
  sourceFieldId: string;
  targetFieldId: string;
}

export interface MigrationResult {
  featureId: string;
  featureName: string;
  sourceFieldName: string;
  targetFieldName: string;
  success: boolean;
  action: string;
  newValue?: any;
  response?: string;
  error?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
