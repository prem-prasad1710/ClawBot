/**
 * tools/notes.js
 * Interact with macOS Notes.app via osascript.
 * Supports: list, read, create, search, append.
 */

import { execSync } from 'child_process';

function osascript(script) {
  // Wrap in a heredoc to avoid quoting nightmares
  const out = execSync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
    timeout: 15000,
  }).toString().trim();
  return out;
}

export class Notes {
  /**
   * List recent notes (title only).
   */
  list(limit = 10) {
    try {
      const script = `
tell application "Notes"
  set noteList to ""
  set n to 0
  repeat with theNote in notes
    set n to n + 1
    if n > ${Math.min(limit, 40)} then exit repeat
    set noteList to noteList & (n as text) & ". " & name of theNote & return
  end repeat
  return noteList
end tell`;
      const result = osascript(script);
      return result || 'No notes found.';
    } catch (e) {
      return `Error listing notes: ${e.message}`;
    }
  }

  /**
   * Read a note's body by partial title match.
   */
  read(titleQuery) {
    try {
      const safe = titleQuery.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `
tell application "Notes"
  repeat with theNote in notes
    if name of theNote contains "${safe}" then
      return "TITLE: " & name of theNote & return & "─────" & return & body of theNote
    end if
  end repeat
  return "Note not found: ${safe}"
end tell`;
      return osascript(script);
    } catch (e) {
      return `Error reading note: ${e.message}`;
    }
  }

  /**
   * Create a new note.
   */
  create(title, body) {
    try {
      const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const safeBody  = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `
tell application "Notes"
  tell account "iCloud"
    make new note with properties {name:"${safeTitle}", body:"${safeBody}"}
  end tell
  return "Note created: ${safeTitle}"
end tell`;
      return osascript(script);
    } catch (e) {
      // Try without iCloud account (local notes)
      try {
        const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const safeBody  = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const script2 = `
tell application "Notes"
  make new note with properties {name:"${safeTitle}", body:"${safeBody}"}
  return "Note created: ${safeTitle}"
end tell`;
        return osascript(script2);
      } catch (e2) {
        return `Error creating note: ${e2.message}`;
      }
    }
  }

  /**
   * Search notes for keyword in title or body.
   */
  search(query) {
    try {
      const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `
tell application "Notes"
  set results to ""
  set n to 0
  repeat with theNote in notes
    if name of theNote contains "${safe}" or body of theNote contains "${safe}" then
      set n to n + 1
      set results to results & (n as text) & ". " & name of theNote & return
      if n >= 10 then exit repeat
    end if
  end repeat
  if results is "" then return "No notes found matching: ${safe}"
  return results
end tell`;
      return osascript(script);
    } catch (e) {
      return `Error searching notes: ${e.message}`;
    }
  }

  /**
   * Append text to an existing note.
   */
  append(titleQuery, text) {
    try {
      const safeTitle = titleQuery.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const safeText  = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `
tell application "Notes"
  repeat with theNote in notes
    if name of theNote contains "${safeTitle}" then
      set body of theNote to (body of theNote) & return & "${safeText}"
      return "Appended to: " & name of theNote
    end if
  end repeat
  return "Note not found: ${safeTitle}"
end tell`;
      return osascript(script);
    } catch (e) {
      return `Error appending to note: ${e.message}`;
    }
  }
}
