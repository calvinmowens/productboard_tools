import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CustomFieldMigration from './modules/custom-field-migration';
import DuplicateNotes from './modules/duplicate-notes';
import CSVImport from './modules/csv-import';
import CSVBulkUpdate from './modules/csv-bulk-update';
import CSVNoteImport from './modules/csv-note-import';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/custom-field-migration" element={<CustomFieldMigration />} />
        <Route path="/duplicate-notes" element={<DuplicateNotes />} />
        <Route path="/csv-import" element={<CSVImport />} />
        <Route path="/csv-bulk-update" element={<CSVBulkUpdate />} />
        <Route path="/csv-note-import" element={<CSVNoteImport />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
