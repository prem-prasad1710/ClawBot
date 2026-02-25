/**
 * tools/contacts.js
 * Search and retrieve contacts from macOS Contacts.app via AppleScript.
 */

import { execSync } from 'child_process';

function osascript(script) {
  return execSync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
    timeout: 15000,
  }).toString().trim();
}

export class Contacts {
  /**
   * Search contacts by name, email, or phone.
   * @param {string} query
   */
  search(query) {
    const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try {
      const script = `
tell application "Contacts"
  set results to ""
  set n to 0
  repeat with p in people
    set nm to name of p
    set matchFound to false
    if nm contains "${safe}" then set matchFound to true
    if not matchFound then
      repeat with em in emails of p
        if value of em contains "${safe}" then set matchFound to true
      end repeat
    end if
    if matchFound then
      set n to n + 1
      if n > 10 then exit repeat
      set results to results & (n as text) & ". " & nm
      try
        set emailVal to value of first email of p
        set results to results & " <" & emailVal & ">"
      end try
      try
        set phoneVal to value of first phone of p
        set results to results & " | " & phoneVal
      end try
      try
        set orgVal to organization of p
        if orgVal is not missing value and orgVal is not "" then
          set results to results & " | " & orgVal
        end if
      end try
      set results to results & return
    end if
  end repeat
  if results is "" then return "No contacts found matching: ${safe}"
  return results
end tell`;
      return osascript(script);
    } catch (e) {
      return `Error searching contacts: ${e.message}`;
    }
  }

  /**
   * Get full details of a contact by name.
   */
  detail(name) {
    const safe = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try {
      const script = `
tell application "Contacts"
  repeat with p in people
    if name of p contains "${safe}" then
      set info to "Name: " & name of p & return
      try
        repeat with em in emails of p
          set info to info & "Email (" & label of em & "): " & value of em & return
        end repeat
      end try
      try
        repeat with ph in phones of p
          set info to info & "Phone (" & label of ph & "): " & value of ph & return
        end repeat
      end try
      try
        set org to organization of p
        if org is not missing value and org is not "" then
          set info to info & "Company: " & org & return
        end if
      end try
      try
        set note to note of p
        if note is not missing value and note is not "" then
          set info to info & "Note: " & note & return
        end if
      end try
      return info
    end if
  end repeat
  return "Contact not found: ${safe}"
end tell`;
      return osascript(script);
    } catch (e) {
      return `Error getting contact: ${e.message}`;
    }
  }
}
