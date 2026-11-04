import fs from "node:fs"
import xlsx from "xlsx"
import * as cptable from "xlsx/dist/cpexcel.full.mjs"

// SheetJS as an ES module loads neither the file system nor the old Excel codepages on its own: readFile fails, and
// € or curly quotes vanish from Excel 95 files. Import xlsx from here, not from "xlsx", so it always has both.
xlsx.set_fs(fs)
xlsx.set_cptable(cptable)

export default xlsx
