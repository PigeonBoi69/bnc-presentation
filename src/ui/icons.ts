import {
  createElement,
  Presentation, LayoutPanelTop, LayoutTemplate, SquarePlus, Plus, Type, Shapes, Image, Images, Table, ChartColumn, ChartBar, ChartLine, ChartPie,
  Link, Video, Music, Volume2, Smile, Sigma, Omega, MessageSquare, MessageSquarePlus, PanelBottom, PanelTop, Hash, CalendarClock,
  Pen, PenLine, Pencil, Highlighter, Eraser, Lasso, MousePointer2, PaintBucket, Paintbrush, Palette, Square, Circle, Minus, Move,
  RotateCw, RotateCcw, FlipHorizontal, FlipVertical, BringToFront, SendToBack, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Group, Ungroup, Layers, Lock, Unlock, Eye, EyeOff, Play, CirclePlay,
  Monitor, MonitorPlay, Projector, Fullscreen, Maximize, Maximize2, ZoomIn, ZoomOut, Grid3x3, LayoutGrid, Ruler, StickyNote,
  NotebookPen, ListOrdered, List, ListTree, Columns2, Columns3, Rows3, TableCellsMerge, TableCellsSplit, Trash2, Copy, Scissors,
  ClipboardPaste, Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Subscript, Superscript, Baseline, RemoveFormatting,
  CaseSensitive, ALargeSmall, AArrowUp, AArrowDown, AlignLeft, AlignCenter, AlignRight, AlignJustify, IndentIncrease, IndentDecrease,
  ArrowUpDown, Search, Replace, Mic, Download, Upload, Save, FolderOpen, FilePlus, FileText, Files, Printer, Share2, Cloud, CloudUpload,
  CloudDownload, Settings, Info, CircleHelp, Keyboard, Languages, SpellCheck, Accessibility, History, Wand, Sparkles, Puzzle, Check, X,
  ChevronDown, ChevronRight, ChevronLeft, ChevronUp, Ellipsis, Moon, Sun, Star, Heart, Triangle, Hexagon, Pentagon, Diamond, Zap, Home,
  RefreshCw, Timer, Clock, FastForward, SkipForward, SkipBack, Film, Clapperboard, Camera, Crop, Scaling, MessageCircle, Bookmark, Flag,
  Box, Spline, Frame, SeparatorHorizontal, ArrowRightLeft, TextSelect, PaintRoller, Pipette, Contrast, SlidersHorizontal, Shrink, Expand,
  Component, Folder, FolderPlus, File, LogOut, User, ListChecks, NotepadText, ArrowDownToLine, ArrowUpToLine, Rows2, TextCursorInput,
  TextQuote, SquareStack, PanelLeft, PanelRight, Wrench, Pointer, MoveDiagonal, Cast, Slash, Waypoints, Pause, Tag,
} from 'lucide';

const ICONS = {
  presentation: Presentation, layoutTop: LayoutPanelTop, layout: LayoutTemplate, newSlide: SquarePlus, plus: Plus, type: Type, shapes: Shapes,
  image: Image, images: Images, table: Table, chart: ChartColumn, chartBar: ChartBar, chartLine: ChartLine, chartPie: ChartPie, link: Link,
  video: Video, audio: Music, volume: Volume2, emoji: Smile, equation: Sigma, symbol: Omega, comment: MessageSquare, newComment: MessageSquarePlus,
  footer: PanelBottom, header: PanelTop, hash: Hash, dateTime: CalendarClock,
  pen: Pen, penLine: PenLine, pencil: Pencil, highlighter: Highlighter, eraser: Eraser, lasso: Lasso, select: MousePointer2,
  fill: PaintBucket, outline: Paintbrush, palette: Palette, square: Square, circle: Circle, minus: Minus, move: Move,
  rotateRight: RotateCw, rotateLeft: RotateCcw, flipH: FlipHorizontal, flipV: FlipVertical, bringFront: BringToFront, sendBack: SendToBack,
  up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight,
  alignTop: AlignStartHorizontal, alignMiddle: AlignCenterHorizontal, alignBottom: AlignEndHorizontal,
  alignLeftEdge: AlignStartVertical, alignCenterEdge: AlignCenterVertical, alignRightEdge: AlignEndVertical,
  distH: AlignHorizontalDistributeCenter, distV: AlignVerticalDistributeCenter, group: Group, ungroup: Ungroup, layers: Layers,
  lock: Lock, unlock: Unlock, view: Eye, hide: EyeOff, play: Play, playCircle: CirclePlay, monitor: Monitor, monitorPlay: MonitorPlay,
  projector: Projector, fullscreen: Fullscreen, maximize: Maximize, fit: Maximize2, zoomIn: ZoomIn, zoomOut: ZoomOut, grid: Grid3x3,
  sorter: LayoutGrid, ruler: Ruler, notes: StickyNote, notePen: NotebookPen, numbering: ListOrdered, bullets: List, outline2: ListTree,
  columns: Columns2, columns3: Columns3, rows: Rows3, mergeCells: TableCellsMerge, splitCells: TableCellsSplit, trash: Trash2, copy: Copy, cut: Scissors,
  paste: ClipboardPaste, undo: Undo2, redo: Redo2, bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough,
  subscript: Subscript, superscript: Superscript, fontColor: Baseline, clearFormat: RemoveFormatting, caseChange: CaseSensitive,
  fontSize: ALargeSmall, grow: AArrowUp, shrink: AArrowDown, alignLeft: AlignLeft, alignCenter: AlignCenter, alignRight: AlignRight,
  alignJustify: AlignJustify, indent: IndentIncrease, outdent: IndentDecrease, lineSpacing: ArrowUpDown, search: Search, replace: Replace,
  mic: Mic, export: Download, upload: Upload, save: Save, open: FolderOpen, new: FilePlus, doc: FileText, files: Files, print: Printer,
  share: Share2, cloud: Cloud, cloudUp: CloudUpload, cloudDown: CloudDownload, settings: Settings, info: Info, help: CircleHelp,
  keyboard: Keyboard, translate: Languages, spelling: SpellCheck, accessibility: Accessibility, history: History, wand: Wand, sparkle: Sparkles,
  puzzle: Puzzle, check: Check, close: X, chevron: ChevronDown, chevronRight: ChevronRight, chevronLeft: ChevronLeft, chevronUp: ChevronUp,
  more: Ellipsis, moon: Moon, sun: Sun, star: Star, heart: Heart, triangle: Triangle, hexagon: Hexagon, pentagon: Pentagon, diamond: Diamond,
  zap: Zap, home: Home, refresh: RefreshCw, timer: Timer, clock: Clock, fastForward: FastForward, skipNext: SkipForward, skipPrev: SkipBack,
  film: Film, transition: Clapperboard, camera: Camera, crop: Crop, scale: Scaling, chat: MessageCircle, bookmark: Bookmark, flag: Flag,
  box: Box, curve: Spline, frame: Frame, pageBreak: SeparatorHorizontal, swap: ArrowRightLeft, textSelect: TextSelect, roller: PaintRoller,
  pipette: Pipette, contrast: Contrast, sliders: SlidersHorizontal, shrinkFit: Shrink, expand: Expand, component: Component, folder: Folder,
  newFolder: FolderPlus, fileBlank: File, logout: LogOut, user: User, checklist: ListChecks, notepad: NotepadText, toBottom: ArrowDownToLine,
  toTop: ArrowUpToLine, rows2: Rows2, textBox: TextCursorInput, quote: TextQuote, stack: SquareStack, panelLeft: PanelLeft, panelRight: PanelRight,
  wrench: Wrench, pointer: Pointer, diagonal: MoveDiagonal, cast: Cast, slash: Slash, waypoints: Waypoints, pause: Pause, tag: Tag,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGElement {
  const node = createElement(ICONS[name], { width: size, height: size, 'stroke-width': 1.8 }) as unknown as SVGElement;
  node.classList.add('ic');
  return node;
}
