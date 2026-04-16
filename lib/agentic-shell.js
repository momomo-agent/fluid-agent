"use strict";
var AgenticShellBrowser = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    AgenticShell: () => AgenticShell,
    MemFS: () => MemFS,
    createBrowserShell: () => createBrowserShell
  });

  // src/index.ts
  function isStreamable(fs) {
    return typeof fs.readStream === "function";
  }
  var AgenticShell = class {
    constructor(fs) {
      this.fs = fs;
      const required = ["read", "write", "ls", "delete", "grep"];
      const missing = required.filter((m) => typeof fs[m] !== "function");
      if (missing.length) throw new Error(`AgenticShell: fs missing required methods: ${missing.join(", ")}`);
      this.env.set("HOME", "/");
      this.env.set("PWD", this.cwd);
      this.env.set("PATH", "/usr/bin:/bin");
    }
    fs;
    cwd = "/";
    env = /* @__PURE__ */ new Map();
    jobs = /* @__PURE__ */ new Map();
    nextJobId = 1;
    setEnv(key, value) {
      this.env.set(key, value);
    }
    getCwd() {
      return this.cwd;
    }
    substituteEnv(cmd) {
      return cmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => this.env.get(n) ?? "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => this.env.get(n) ?? "");
    }
    async substituteCommands(cmd, depth = 0, maxDepth = 3) {
      if (depth >= maxDepth) return cmd;
      let result = cmd;
      while (true) {
        const start = result.indexOf("$(");
        if (start === -1) break;
        let pdepth = 0, end = -1;
        for (let i = start + 1; i < result.length; i++) {
          if (result[i] === "(") pdepth++;
          else if (result[i] === ")") {
            pdepth--;
            if (pdepth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end === -1) break;
        const inner = result.slice(start + 2, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      while (true) {
        const start = result.indexOf("`");
        if (start === -1) break;
        const end = result.indexOf("`", start + 1);
        if (end === -1) break;
        const inner = result.slice(start + 1, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      return result;
    }
    getEnv(key) {
      return this.env.get(key);
    }
    isBackground(cmd) {
      const trimmed = cmd.trimEnd();
      if (trimmed.endsWith("&")) return [true, trimmed.slice(0, -1).trimEnd()];
      return [false, cmd];
    }
    async exec(command, depth = 0) {
      const afterEnv = this.substituteEnv(command.trim());
      const substituted = await this.substituteCommands(afterEnv, depth);
      const [isBg, cleanCmd] = this.isBackground(substituted);
      if (isBg) {
        if (!cleanCmd) return { output: "exec: missing command", exitCode: 1 };
        const id = this.nextJobId++;
        const promise = this.execPipeline(cleanCmd).then((result) => {
          this.jobs.get(id).status = "done";
          return result;
        });
        this.jobs.set(id, { id, command: cleanCmd, status: "running", promise });
        return { output: `[${id}] ${id}`, exitCode: 0 };
      }
      return this.execPipeline(substituted);
    }
    async execPipeline(command) {
      const trimmed = command;
      if (!trimmed) return { output: "", exitCode: 0 };
      const assignMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
      if (assignMatch) {
        this.env.set(assignMatch[1], assignMatch[2]);
        return { output: "", exitCode: 0 };
      }
      const inputMatch = trimmed.match(/^(.+?)\s+<\s+(\S+)((?:\s*>>?\s*\S+)?)$/);
      if (inputMatch) {
        const lhs = inputMatch[1].trim();
        const redirectFile = this.resolve(inputMatch[2]);
        const remainder = inputMatch[3].trim();
        if (!lhs) return { output: "bash: syntax error near unexpected token `<'", exitCode: 1 };
        const r = await this.fs.read(redirectFile);
        if (r.error) return { output: `bash: ${inputMatch[2]}: No such file or directory`, exitCode: 1 };
        const stdin = r.content ?? "";
        const cmdOutput = await this.execWithStdin(lhs, stdin);
        const lhsCmd = lhs.trim().split(/\s+/)[0];
        const exitCode2 = lhsCmd === "grep" && cmdOutput === "" ? 1 : this.exitCodeFor(cmdOutput);
        if (remainder) {
          const appendRem = remainder.match(/^>>\s*(\S+)$/);
          const writeRem = remainder.match(/^>\s*(\S+)$/);
          if (appendRem) {
            const outPath = this.resolve(appendRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            const existing = await this.fs.read(outPath);
            const current = existing.error ? "" : existing.content ?? "";
            await this.fs.write(outPath, current + cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          } else if (writeRem) {
            const outPath = this.resolve(writeRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            await this.fs.write(outPath, cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          }
        }
        return { output: cmdOutput, exitCode: exitCode2 };
      }
      const appendMatch = trimmed.match(/^(.+?)>>\s*(\S+)$/);
      if (appendMatch) {
        const lhs = appendMatch[1].trim();
        const filePath = this.resolve(appendMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        const existing = await this.fs.read(filePath);
        const current = existing.error ? "" : existing.content ?? "";
        await this.fs.write(filePath, current + output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      const writeMatch = trimmed.match(/^(.+?)>\s*(\S+)$/);
      if (writeMatch) {
        const lhs = writeMatch[1].trim();
        const filePath = this.resolve(writeMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        await this.fs.write(filePath, output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      if (trimmed.includes(" | ")) {
        const segments = trimmed.split(" | ");
        let output2 = "";
        let exitCode2 = 0;
        for (let i = 0; i < segments.length; i++) {
          if (i === 0) {
            const execResult = await this.execSingleWithError(segments[i].trim());
            output2 = execResult.output;
            if (execResult.hadError) {
              exitCode2 = this.exitCodeFor(output2);
              output2 = "";
            }
          } else {
            output2 = await this.execWithStdin(segments[i].trim(), output2);
            const segCmd = segments[i].trim().split(/\s+/)[0];
            if (exitCode2 === 0) {
              if (segCmd === "grep" && output2 === "") exitCode2 = 1;
              else if (this.isErrorOutput(output2)) exitCode2 = this.exitCodeFor(output2);
            }
          }
        }
        if (exitCode2 === 0) exitCode2 = this.exitCodeFor(output2);
        return { output: output2, exitCode: exitCode2 };
      }
      const output = await this.execSingle(trimmed);
      const cmd = trimmed.split(/\s+/)[0];
      const exitCode = cmd === "grep" && output === "" ? 1 : this.exitCodeFor(output);
      return { output, exitCode };
    }
    async jobs_cmd(_args) {
      if (this.jobs.size === 0) return "";
      return [...this.jobs.values()].map((j) => `[${j.id}] ${j.status.padEnd(9)} ${j.command}`).join("\n");
    }
    async fg(args) {
      let id;
      if (!args[0]) {
        id = Math.max(...this.jobs.keys());
        if (!isFinite(id)) return "fg: current: no such job";
      } else {
        id = parseInt(args[0].replace("%", ""));
      }
      if (isNaN(id) || !this.jobs.has(id)) return `fg: ${args[0] ?? ""}: no such job`;
      const job = this.jobs.get(id);
      const result = await job.promise;
      this.jobs.delete(id);
      return result.output;
    }
    async bg(args) {
      const id = parseInt((args[0] ?? "").replace("%", ""));
      if (isNaN(id) || !this.jobs.has(id)) return `bg: ${args[0] ?? ""}: no such job`;
      return "";
    }
    exitCodeFor(output) {
      const first = output.trimStart().split("\n")[0];
      if (/\bcommand not found\b/.test(first)) return 2;
      if (/\b(missing operand|missing pattern|Invalid regular expression)\b/.test(first)) return 2;
      if (/^\w[\w-]*: .+: .+/.test(first)) return 1;
      return 0;
    }
    async execSingle(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "ls":
          return this.ls(args);
        case "cat":
          return this.cat(args);
        case "grep":
          return this.grep(args);
        case "find":
          return this.find(args);
        case "pwd":
          return this.cwd;
        case "cd":
          return this.cd(args[0]);
        case "mkdir":
          return this.mkdir(args);
        case "rm":
          return this.rm(args);
        case "mv":
          return this.mv(args);
        case "cp":
          return this.cp(args);
        case "echo":
          return args.join(" ");
        case "export": {
          const expr = args.join(" ");
          const m = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (m) {
            this.env.set(m[1], m[2]);
            return "";
          }
          return "export: not supported";
        }
        case "touch":
          return this.touch(args[0]);
        case "head":
          return this.head(args);
        case "tail":
          return this.tail(args);
        case "wc":
          return this.wc(args);
        case "jobs":
          return this.jobs_cmd(args);
        case "fg":
          return this.fg(args);
        case "bg":
          return this.bg(args);
        default:
          return `${cmd}: command not found`;
      }
    }
    async execSingleWithError(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "cat": {
          const expanded = await this.expandPathArgs(args);
          const paths = expanded.filter((a) => !a.startsWith("-"));
          if (!paths.length) return { output: "cat: missing operand", hadError: true };
          const results = await Promise.all(paths.map(async (p) => {
            if (/[*?]/.test(p)) return { text: `cat: ${p}: No such file or directory`, err: true };
            const r = await this.fs.read(this.resolve(p));
            return r.error ? { text: this.fsError("cat", p, r.error), err: true } : { text: r.content ?? "", err: false };
          }));
          const hadError = results.some((r) => r.err);
          return { output: results.map((r) => r.text).join("\n"), hadError };
        }
        case "echo":
          return { output: args.join(" "), hadError: false };
        case "pwd":
          return { output: this.cwd, hadError: false };
        default: {
          const output = await this.execSingle(command);
          return { output, hadError: this.isErrorOutput(output) };
        }
      }
    }
    async execWithStdin(command, stdin) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      if (cmd === "wc") {
        const flags = args.filter((a) => a.startsWith("-"));
        const lines = stdin === "" ? 0 : stdin.split("\n").length;
        const words = stdin.split(/\s+/).filter(Boolean).length;
        const chars = stdin.length;
        if (flags.includes("-l")) return String(lines);
        if (flags.includes("-w")) return String(words);
        if (flags.includes("-c")) return String(chars);
        return `${lines}	${words}	${chars}`;
      }
      if (cmd === "grep") {
        const rawFlags = args.filter((a) => a.startsWith("-"));
        const rest = args.filter((a) => !a.startsWith("-"));
        const flags = [];
        for (const f of rawFlags) {
          if (f.length > 2 && f.startsWith("-")) {
            for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
          } else {
            flags.push(f);
          }
        }
        const [pattern] = rest;
        if (!pattern) return "grep: missing pattern";
        const caseInsensitive = flags.includes("-i");
        let regex;
        try {
          regex = new RegExp(pattern, caseInsensitive ? "i" : "");
        } catch {
          return `grep: ${pattern}: Invalid regular expression`;
        }
        const lines = stdin.split("\n").filter((l) => regex.test(l));
        if (!lines.length) return "";
        if (flags.includes("-l")) return lines.length ? "(stdin)" : "";
        if (flags.includes("-c")) return String(lines.length);
        return lines.join("\n");
      }
      return this.execSingle(command);
    }
    checkWritable(cmd, path) {
      if (this.fs.readOnly === true) return `${cmd}: ${path}: Permission denied`;
      return null;
    }
    isErrorOutput(output) {
      return /^\w+: .+: .+/.test(output.trimStart().split("\n")[0]);
    }
    fsError(cmd, path, err) {
      if (err?.toLowerCase().includes("not found") || err?.toLowerCase().includes("no such"))
        return `${cmd}: ${path}: No such file or directory`;
      return `${cmd}: ${path}: ${err}`;
    }
    normalizePath(path) {
      const parts = path.split("/").filter(Boolean);
      const stack = [];
      for (const part of parts) {
        if (part === "..") {
          if (stack.length) stack.pop();
        } else if (part !== ".") stack.push(part);
      }
      return "/" + stack.join("/");
    }
    resolve(path) {
      if (!path || path === ".") return this.cwd;
      const raw = path.startsWith("/") ? path : (this.cwd === "/" ? "" : this.cwd) + "/" + path;
      return this.normalizePath(raw);
    }
    parseArgs(cmd) {
      const parts = [];
      let cur = "", inQ = false, q = "";
      for (const ch of cmd) {
        if (inQ) {
          if (ch === q) inQ = false;
          else cur += ch;
        } else if (ch === '"' || ch === "'") {
          inQ = true;
          q = ch;
        } else if (ch === " ") {
          if (cur) {
            parts.push(cur);
            cur = "";
          }
        } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    }
    matchGlob(name, pattern) {
      let re = "";
      let i = 0;
      while (i < pattern.length) {
        const ch = pattern[i];
        if (ch === "[") {
          const close = pattern.indexOf("]", i + 1);
          if (close !== -1) {
            let bracket = pattern.slice(i, close + 1);
            if (bracket.length > 3 && bracket[1] === "!") {
              bracket = "[^" + bracket.slice(2);
            }
            re += bracket;
            i = close + 1;
            continue;
          }
        }
        if (ch === "*") {
          re += ".*";
          i++;
          continue;
        }
        if (ch === "?") {
          re += ".";
          i++;
          continue;
        }
        re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        i++;
      }
      return new RegExp("^" + re + "$").test(name);
    }
    async expandRecursiveGlob(baseDir, pattern) {
      const results = [];
      const visited = /* @__PURE__ */ new Set();
      const stack = [baseDir];
      while (stack.length) {
        const dir = stack.pop();
        if (visited.has(dir)) continue;
        visited.add(dir);
        let entries;
        try {
          entries = await this.fs.ls(dir);
        } catch {
          continue;
        }
        for (const e of entries) {
          const fullPath = dir === "/" ? "/" + e.name : dir + "/" + e.name;
          if (e.type === "dir") {
            stack.push(fullPath);
          }
          if (this.matchGlob(e.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }
    async expandGlob(pattern, dir) {
      if (!/[*?[]/.test(pattern)) return [pattern];
      const doubleStarIdx = pattern.indexOf("**");
      if (doubleStarIdx !== -1) {
        const before = pattern.slice(0, doubleStarIdx).replace(/\/$/, "");
        const after = pattern.slice(doubleStarIdx + 2).replace(/^\//, "");
        const baseDir = before ? this.resolve(before) : dir;
        const matchPattern = after || "*";
        return this.expandRecursiveGlob(baseDir, matchPattern);
      }
      const entries = await this.fs.ls(dir);
      return entries.filter((e) => e.type === "file" && this.matchGlob(e.name, pattern)).map((e) => dir === "/" ? "/" + e.name : dir + "/" + e.name);
    }
    async expandPathArgs(args) {
      const result = [];
      for (const a of args) {
        if (a.startsWith("-") || !/[*?[]/.test(a)) {
          result.push(a);
          continue;
        }
        const matches = await this.expandGlob(a, this.cwd);
        if (matches.length) result.push(...matches);
        else result.push(a);
      }
      return result;
    }
    async ls(args) {
      const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
      const all = args.includes("-a") || args.includes("-la") || args.includes("-al");
      const pageIdx = args.indexOf("--page");
      const page = pageIdx !== -1 ? parseInt(args[pageIdx + 1]) : null;
      const sizeIdx = args.indexOf("--page-size");
      const pageSize = sizeIdx !== -1 ? parseInt(args[sizeIdx + 1]) : 20;
      const flagArgs = /* @__PURE__ */ new Set(["-l", "-a", "-la", "-al", "--page", "--page-size"]);
      const flagValues = /* @__PURE__ */ new Set();
      if (pageIdx !== -1 && args[pageIdx + 1]) flagValues.add(args[pageIdx + 1]);
      if (sizeIdx !== -1 && args[sizeIdx + 1]) flagValues.add(args[sizeIdx + 1]);
      const pathArg = args.find((a) => !a.startsWith("-") && !flagValues.has(a));
      if (pathArg && /[*?[]/.test(pathArg)) {
        const matches = await this.expandGlob(pathArg, this.cwd);
        if (!matches.length) return `ls: ${pathArg}: No such file or directory`;
        return matches.map((p) => p.split("/").pop()).join("\n");
      }
      const path = pathArg || this.cwd;
      let lsResult;
      try {
        lsResult = await this.fs.ls(this.resolve(path));
      } catch (err) {
        return this.fsError("ls", path, err.message ?? String(err));
      }
      if (lsResult && lsResult.error) return this.fsError("ls", path, lsResult.error);
      let entries = lsResult;
      if (all) {
        const hasDot = entries.some((e) => e.name === ".");
        const hasDotDot = entries.some((e) => e.name === "..");
        const synthetic = [];
        if (!hasDot) synthetic.push({ name: ".", type: "dir" });
        if (!hasDotDot) synthetic.push({ name: "..", type: "dir" });
        entries = [...synthetic, ...entries];
      } else {
        entries = entries.filter((e) => !e.name.startsWith("."));
      }
      if (page !== null) {
        const validPage = Math.max(1, page);
        const validPageSize = pageSize > 0 ? pageSize : 20;
        const start = (validPage - 1) * validPageSize;
        const end = start + validPageSize;
        entries = entries.slice(start, end);
      }
      if (!entries.length) return "";
      if (long) {
        return entries.map((e) => `${e.type === "dir" ? "d" : "-"}rwxr-xr-x  ${e.name}`).join("\n");
      }
      return entries.map((e) => e.type === "dir" ? e.name + "/" : e.name).join("\n");
    }
    async cat(args) {
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (!paths.length) return "cat: missing operand";
      const results = await Promise.all(paths.map(async (p) => {
        if (/[*?]/.test(p)) return `cat: ${p}: No such file or directory`;
        const r = await this.fs.read(this.resolve(p));
        return r.error ? this.fsError("cat", p, r.error) : r.content ?? "";
      }));
      return results.join("\n");
    }
    async grep(args) {
      const rawFlags = args.filter((a) => a.startsWith("-"));
      const rest = args.filter((a) => !a.startsWith("-"));
      const [pattern, ...paths] = rest;
      if (!pattern) return "grep: missing pattern";
      const flags = [];
      for (const f of rawFlags) {
        if (f.length > 2 && f.startsWith("-")) {
          for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
        } else {
          flags.push(f);
        }
      }
      try {
        new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        return `grep: ${pattern}: Invalid regular expression`;
      }
      const recursive = flags.includes("-r") || flags.includes("-R");
      const expandedPaths = [];
      for (const p of paths) {
        if (/[*?]/.test(p)) {
          const matches = await this.expandGlob(p, this.cwd);
          expandedPaths.push(...matches);
        } else {
          expandedPaths.push(p);
        }
      }
      if (paths.length > 0 && expandedPaths.length === 0)
        return `grep: ${paths[0]}: No such file or directory`;
      const resolvedPaths = expandedPaths.length ? expandedPaths : paths;
      if (resolvedPaths.length === 1 && !recursive) {
        const singlePath = resolvedPaths[0];
        try {
          const raw = await this.grepStream(pattern, singlePath, flags);
          const warning = raw[0]?.startsWith("grep: warning:") ? raw[0] : void 0;
          const matches = warning ? raw.slice(1) : raw;
          if (flags.includes("-c")) return (warning ? warning + "\n" : "") + String(matches.length);
          if (!matches.length) return warning ?? "";
          if (flags.includes("-l")) return (warning ? warning + "\n" : "") + singlePath;
          return raw.join("\n");
        } catch (err) {
          return this.fsError("grep", singlePath, String(err));
        }
      }
      if (resolvedPaths.length > 1 && !recursive && isStreamable(this.fs)) {
        const allMatches = [];
        for (const p of resolvedPaths) {
          try {
            const raw = await this.grepStream(pattern, p, flags);
            allMatches.push(...raw.filter((m) => !m.startsWith("grep: warning:")));
          } catch (err) {
            allMatches.push(this.fsError("grep", p, String(err)));
          }
        }
        if (flags.includes("-c")) return String(allMatches.length);
        if (!allMatches.length) return "";
        if (flags.includes("-l")) return [...new Set(allMatches.map((m) => m.split(":")[0]))].join("\n");
        return allMatches.join("\n");
      }
      const caseInsensitive = flags.includes("-i");
      if (caseInsensitive && (resolvedPaths.length > 0 || recursive)) {
        const regex = new RegExp(pattern, "i");
        const files = [];
        const searchDirs = resolvedPaths.length ? resolvedPaths : [this.cwd];
        for (const p of searchDirs) {
          const resolved = this.resolve(p);
          let isDir = false;
          try {
            await this.fs.ls(resolved);
            isDir = true;
          } catch {
          }
          if (isDir) {
            if (recursive) {
              const collected = await this.findRecursive(resolved, void 0, "f");
              files.push(...collected);
            } else {
              return `grep: ${p}: is a directory`;
            }
          } else {
            files.push(resolved);
          }
        }
        const ciResults = [];
        for (const file of files) {
          const r = await this.fs.read(file);
          if (r.error) continue;
          const lines = (r.content ?? "").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              ciResults.push({ path: file, line: i + 1, content: lines[i] });
            }
          }
        }
        if (flags.includes("-c")) return String(ciResults.length);
        if (!ciResults.length) {
          for (const p of searchDirs) {
            const resolved = this.resolve(p);
            let lsThrew = false;
            try {
              await this.fs.ls(resolved);
            } catch {
              lsThrew = true;
            }
            if (lsThrew) return this.fsError("grep", p, "No such file or directory");
          }
          return "";
        }
        if (flags.includes("-l")) return [...new Set(ciResults.map((r) => r.path))].join("\n");
        return ciResults.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
      }
      const allResults = await this.fs.grep(pattern);
      const searchPaths = resolvedPaths.length ? resolvedPaths : recursive ? [this.cwd] : [];
      const pathFiltered = searchPaths.length ? allResults.filter((r) => searchPaths.some((p) => r.path.startsWith(this.resolve(p)))) : allResults;
      const filtered = caseInsensitive ? (() => {
        const re = new RegExp(pattern, "i");
        return pathFiltered.filter((r) => re.test(r.content));
      })() : pathFiltered;
      if (flags.includes("-c")) return String(filtered.length);
      if (!filtered.length) {
        for (const p of searchPaths) {
          const resolved = this.resolve(p);
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (lsThrew) return this.fsError("grep", p, "No such file or directory");
        }
        return "";
      }
      if (flags.includes("-l")) return [...new Set(filtered.map((r) => r.path))].join("\n");
      return filtered.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
    }
    async grepStream(pattern, path, flags) {
      const resolved = this.resolve(path);
      let regex;
      try {
        regex = new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        throw new Error(`${pattern}: Invalid regular expression`);
      }
      if (isStreamable(this.fs)) {
        const matches2 = [];
        let lineNum = 0;
        for await (const line of this.fs.readStream(resolved)) {
          lineNum++;
          if (regex.test(line)) matches2.push(`${resolved}:${lineNum}: ${line}`);
        }
        return matches2;
      }
      const WARNING = "grep: warning: streaming unavailable, using read() fallback";
      const r = await this.fs.read(resolved);
      if (r.error) throw new Error(r.error);
      const lines = (r.content ?? "").split("\n");
      const matches = [];
      lines.forEach((line, idx) => {
        if (regex.test(line)) matches.push(`${resolved}:${idx + 1}: ${line}`);
      });
      return [WARNING, ...matches];
    }
    async findRecursive(basePath, namePattern, typeFilter, visited = /* @__PURE__ */ new Set()) {
      if (visited.has(basePath)) return [];
      visited.add(basePath);
      let entries;
      try {
        entries = await this.fs.ls(basePath);
      } catch {
        return [];
      }
      const results = [];
      for (const e of entries) {
        const fullPath = basePath.replace(/\/$/, "") + "/" + e.name;
        const matchesType = !typeFilter || e.type === (typeFilter === "f" ? "file" : "dir");
        const matchesName = !namePattern || namePattern.test(e.name);
        if (matchesType && matchesName) results.push(fullPath);
        if (e.type === "dir") results.push(...await this.findRecursive(fullPath, namePattern, typeFilter, visited));
      }
      return results;
    }
    async find(args) {
      const nameIdx = args.indexOf("-name");
      const typeIdx = args.indexOf("-type");
      const namePatternStr = nameIdx !== -1 ? args[nameIdx + 1] : void 0;
      const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : void 0;
      const basePath = args[0]?.startsWith("-") ? this.cwd : args[0] || this.cwd;
      const nameRegex = namePatternStr ? new RegExp("^" + namePatternStr.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$") : void 0;
      const results = await this.findRecursive(this.resolve(basePath), nameRegex, typeFilter);
      return results.join("\n");
    }
    async cd(path) {
      if (!path || path === "~") {
        this.cwd = "/";
        this.env.set("PWD", "/");
        return "";
      }
      const resolved = this.resolve(path);
      try {
        await this.fs.ls(resolved);
      } catch {
        return `cd: ${path}: No such file or directory`;
      }
      const r = await this.fs.read(resolved);
      if (!r.error && r.content !== void 0) return `cd: ${path}: Not a directory`;
      this.cwd = resolved;
      this.env.set("PWD", resolved);
      return "";
    }
    parentOf(path) {
      const parts = path.replace(/\/$/, "").split("/");
      parts.pop();
      return parts.join("/") || "/";
    }
    async mkdirOne(resolved) {
      if (typeof this.fs.mkdir === "function") {
        await this.fs.mkdir(resolved);
      } else {
        await this.fs.write(resolved + "/.keep", "");
      }
    }
    async mkdir(args) {
      const recursive = args.includes("-p");
      const paths = args.filter((a) => !a.startsWith("-"));
      const err = this.checkWritable("mkdir", this.resolve(paths[0] ?? ""));
      if (err) return err;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (recursive) {
          const segments = resolved.replace(/^\//, "").split("/");
          let prefix = "";
          for (const seg of segments) {
            prefix += "/" + seg;
            try {
              await this.mkdirOne(prefix);
            } catch {
            }
          }
        } else {
          try {
            await this.fs.ls(this.parentOf(resolved));
          } catch {
            return `mkdir: ${p}: No such file or directory`;
          }
          try {
            await this.mkdirOne(resolved);
          } catch (e) {
            const msg = e.message ?? String(e);
            if (msg.toLowerCase().includes("exist"))
              return `mkdir: ${p}: File exists`;
            return `mkdir: ${p}: No such file or directory`;
          }
        }
      }
      return "";
    }
    async rmRecursive(path) {
      const stack = [path];
      const toDelete = [];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        toDelete.push(cur);
        const entries = await this.fs.ls(cur);
        for (const e of entries) {
          const child = cur.replace(/\/$/, "") + "/" + e.name;
          if (e.type === "dir") stack.push(child);
          else toDelete.push(child);
        }
      }
      for (let i = toDelete.length - 1; i >= 0; i--) {
        await this.fs.delete(toDelete[i]);
      }
    }
    async rm(args) {
      const recursive = args.includes("-r") || args.includes("-rf");
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (paths.length === 0) return "rm: missing operand";
      const werr = this.checkWritable("rm", this.resolve(paths[0] ?? ""));
      if (werr) return werr;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (resolved === "/") return "rm: refusing to remove '/'";
        if (recursive) {
          try {
            await this.rmRecursive(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        } else {
          const r = await this.fs.read(resolved);
          if (r.error && /no such file/i.test(r.error)) return this.fsError("rm", p, "No such file or directory");
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (!lsThrew) return `rm: ${p}: is a directory`;
          try {
            await this.fs.delete(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        }
      }
      return "";
    }
    async mv(args) {
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "mv: missing operand";
      const srcPath = this.resolve(src);
      const dstPath = this.resolve(dst);
      const werr = this.checkWritable("mv", srcPath);
      if (werr) return werr;
      let isDir = false;
      try {
        await this.fs.ls(srcPath);
        isDir = true;
      } catch {
      }
      if (isDir) {
        const copyErr = await this.copyRecursive(srcPath, dstPath);
        if (copyErr) return copyErr;
        try {
          await this.rmRecursive(srcPath);
        } catch (e) {
          return this.fsError("mv", src, e.message ?? String(e));
        }
        return "";
      } else {
        const r = await this.fs.read(srcPath);
        if (r.error) return this.fsError("mv", src, r.error);
        await this.fs.write(dstPath, r.content ?? "");
        await this.fs.delete(srcPath);
        return "";
      }
    }
    async cp(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const recursive = flags.includes("-r") || flags.includes("-R");
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "cp: missing operand";
      const werr = this.checkWritable("cp", this.resolve(dst));
      if (werr) return werr;
      if (/[*?]/.test(src)) {
        const matches = await this.expandGlob(src, this.cwd);
        if (!matches.length) return `cp: ${src}: No such file or directory`;
        for (const m of matches) {
          const name = m.split("/").pop();
          const dstPath = this.resolve(dst) + "/" + name;
          const r2 = await this.fs.read(m);
          if (r2.error) return this.fsError("cp", m, r2.error);
          await this.fs.write(dstPath, r2.content ?? "");
        }
        return "";
      }
      if (recursive) return this.copyRecursive(this.resolve(src), this.resolve(dst));
      try {
        await this.fs.ls(this.resolve(src));
        return `cp: ${src}: -r not specified; omitting directory`;
      } catch {
      }
      const r = await this.fs.read(this.resolve(src));
      if (r.error) return this.fsError("cp", src, r.error);
      await this.fs.write(this.resolve(dst), r.content ?? "");
      return "";
    }
    async copyRecursive(src, dst) {
      let entries;
      try {
        entries = await this.fs.ls(src);
      } catch (err) {
        return this.fsError("cp", src, String(err));
      }
      if (typeof this.fs.mkdir === "function") {
        try {
          await this.fs.mkdir(dst);
        } catch {
        }
      }
      for (const entry of entries) {
        const srcPath = src + "/" + entry.name;
        const dstPath = dst + "/" + entry.name;
        if (entry.type === "dir") {
          const err = await this.copyRecursive(srcPath, dstPath);
          if (err) return err;
        } else {
          const r = await this.fs.read(srcPath);
          if (r.error) return this.fsError("cp", srcPath, r.error);
          await this.fs.write(dstPath, r.content ?? "");
        }
      }
      return "";
    }
    async touch(path) {
      if (!path) return "touch: missing operand";
      const werr = this.checkWritable("touch", this.resolve(path));
      if (werr) return werr;
      const r = await this.fs.read(this.resolve(path));
      if (r.content === void 0 || r.content === null) await this.fs.write(this.resolve(path), "");
      return "";
    }
    async head(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "head: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("head", path, r.error);
      return (r.content ?? "").split("\n").slice(0, n).join("\n");
    }
    async tail(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "tail: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("tail", path, r.error);
      const lines = (r.content ?? "").split("\n");
      return lines.slice(-n).join("\n");
    }
    async wc(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const path = args.find((a) => !a.startsWith("-"));
      if (!path) return "wc: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("wc", path, r.error);
      const content = r.content ?? "";
      const lines = content === "" ? 0 : content.split("\n").length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      if (flags.includes("-l")) return `${lines}	${path}`;
      if (flags.includes("-w")) return `${words}	${path}`;
      if (flags.includes("-c")) return `${chars}	${path}`;
      return `${lines}	${words}	${chars}	${path}`;
    }
  };

  // src/browser.ts
  var MemFS = class {
    files = /* @__PURE__ */ new Map();
    dirs = /* @__PURE__ */ new Set(["/"]);
    normalize(p) {
      return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    }
    async read(path) {
      const f = this.files.get(this.normalize(path));
      if (f === void 0) throw new Error(`ENOENT: ${path}`);
      return f;
    }
    async write(path, content) {
      const p = this.normalize(path);
      const dir = p.split("/").slice(0, -1).join("/") || "/";
      this.dirs.add(dir);
      this.files.set(p, content);
    }
    async ls(path) {
      const p = this.normalize(path);
      const entries = [];
      const prefix = p === "/" ? "/" : p + "/";
      for (const [fp] of this.files) {
        if (fp.startsWith(prefix) && !fp.slice(prefix.length).includes("/"))
          entries.push({ name: fp.slice(prefix.length), type: "file", size: this.files.get(fp).length });
      }
      for (const dp of this.dirs) {
        if (dp !== p && dp.startsWith(prefix) && !dp.slice(prefix.length).includes("/"))
          entries.push({ name: dp.slice(prefix.length), type: "dir", size: 0 });
      }
      return entries;
    }
    async delete(path) {
      this.files.delete(this.normalize(path));
    }
    async mkdir(path) {
      this.dirs.add(this.normalize(path));
    }
    async exists(path) {
      const p = this.normalize(path);
      return this.files.has(p) || this.dirs.has(p);
    }
    async grep(pattern, path, opts) {
      const re = new RegExp(pattern);
      const results = [];
      const check = async (fp) => {
        const content = this.files.get(fp);
        if (!content) return;
        content.split("\n").forEach((line, i) => {
          if (re.test(line)) results.push({ file: fp, line: i + 1, content: line });
        });
      };
      const p = this.normalize(path);
      if (this.files.has(p)) {
        await check(p);
      } else if (opts?.recursive) {
        for (const fp of this.files.keys()) if (fp.startsWith(p + "/")) await check(fp);
      }
      return results;
    }
  };
  function createBrowserShell(existingFs) {
    const fs = existingFs || new MemFS();
    return new AgenticShell(fs);
  }
  return __toCommonJS(browser_exports);
})();
