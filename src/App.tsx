import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MousePointer2, Pencil, Trash2, RotateCcw, Copy, Info, MousePointer, Ruler } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Shape {
  id: string;
  points: Point[];
  position: Point;
  rotation: number;
  color: string;
  type: 'triangle' | 'trapezoid' | 'parallelogram' | 'piece';
}

const COLORS = [
  '#FF6B6B', '#FF9248', '#FFCC33', '#6BCB77', '#4D96FF', '#9B72AA',
  '#F06292', '#BA68C8', '#4DB6AC', '#AED581', '#FFD54F', '#FF8A65'
];

const GRID_SIZE = 30;

export default function App() {
  const [mode, setMode] = useState<'draw' | 'select' | 'cut'>('select');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);

  const addToHistory = useCallback(() => {
    setHistory(prev => {
      const newHistory = [...prev, [...shapes]];
      if (newHistory.length > 20) return newHistory.slice(1);
      return newHistory;
    });
  }, [shapes]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const lastShapes = history[history.length - 1];
    setShapes(lastShapes);
    setHistory(prev => prev.slice(0, -1));
    setSelectedId(null);
    setToastMessage('이전 상태로 되돌렸습니다. 🔄');
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 2000);
  }, [history]);
  const [drawingPath, setDrawingPath] = useState<Point[]>([]);
  const [cutLine, setCutLine] = useState<{ start: Point; end: Point } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mouseDownPos, setMouseDownPos] = useState<Point | null>(null);
  const [hasStartedDragging, setHasStartedDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [showRuler, setShowRuler] = useState(false);
  const [isCutLineSelected, setIsCutLineSelected] = useState(false);
  const [rulerPos, setRulerPos] = useState<Point>({ x: 100, y: 100 });
  const [rulerRot, setRulerRot] = useState(0);
  const [isDraggingRuler, setIsDraggingRuler] = useState(false);
  const [rulerDragOffset, setRulerDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [showGuide, setShowGuide] = useState(true);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('새로운 삼각형 완성! ✨');

  const containerRef = useRef<HTMLDivElement>(null);

  const snapToGrid = useCallback((val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE, []);

  // Triangle recognition: Find 3 points that form the largest triangle within the path
  const recognizeTriangle = (path: Point[]): [Point, Point, Point] | null => {
    if (path.length < 5) return null;

    // 1. Simplify the path to reduce noise (take every 2nd or 3rd point if long)
    const simplified = path.filter((_, i) => i % 4 === 0);
    
    // 2. Find the 3 points that form the triangle with the maximum area
    let maxArea = 0;
    let bestIndices = [0, Math.floor(simplified.length / 3), Math.floor(2 * simplified.length / 3)];

    // Optimization: sampling indices to find the max area triangle
    for (let i = 0; i < simplified.length; i++) {
      for (let j = i + 1; j < simplified.length; j++) {
        for (let k = j + 1; k < simplified.length; k++) {
          const area = Math.abs(
            simplified[i].x * (simplified[j].y - simplified[k].y) +
            simplified[j].x * (simplified[k].y - simplified[i].y) +
            simplified[k].x * (simplified[i].y - simplified[j].y)
          ) / 2;
          if (area > maxArea) {
            maxArea = area;
            bestIndices = [i, j, k];
          }
        }
      }
    }

    if (maxArea < 300) return null; // Too small to be a triangle

    const p1 = simplified[bestIndices[0]];
    const p2 = simplified[bestIndices[1]];
    const p3 = simplified[bestIndices[2]];

    // 3. Post-process to detect right angles
    // Snap each point to grid first
    const s1 = { x: snapToGrid(p1.x), y: snapToGrid(p1.y) };
    const s2 = { x: snapToGrid(p2.x), y: snapToGrid(p2.y) };
    const s3 = { x: snapToGrid(p3.x), y: snapToGrid(p3.y) };

    const vertices: [Point, Point, Point] = [s1, s2, s3];
    
    // 4. Ensure at least one side is horizontal (aligned with grid lines)
    // Find the pair of points with the smallest Y difference
    const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
    let minDy = Infinity;
    let bestPair = pairs[0];
    
    pairs.forEach(([i, j]) => {
      const dy = Math.abs(vertices[i].y - vertices[j].y);
      if (dy < minDy) {
        minDy = dy;
        bestPair = [i, j];
      }
    });

    // Make the best pair horizontal
    const [bi, bj] = bestPair;
    const targetY = vertices[bi].y;
    vertices[bj].y = targetY;

    // 5. Optimize the third vertex to align with 15-degree increments relative to the base
    const bk = [0, 1, 2].find(idx => idx !== bi && idx !== bj) as number;
    const pBase1 = vertices[bi];
    const pBase2 = vertices[bj];
    const originalV3 = vertices[bk];
    
    let bestV3 = originalV3;
    let minAngleError = Infinity;

    // Search nearby grid points to find one that best fits 15-degree angles AND even height
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -10; dy <= 10; dy++) {
        const testV3 = { 
          x: originalV3.x + dx * GRID_SIZE, 
          y: originalV3.y + dy * GRID_SIZE 
        };
        
        // Skip if same as base points
        if ((testV3.x === pBase1.x && testV3.y === pBase1.y) || (testV3.x === pBase2.x && testV3.y === pBase2.y)) continue;
        
        // Requirement: Height must be an even multiple of GRID_SIZE
        const height = Math.abs(testV3.y - pBase1.y);
        const heightInUnits = Math.round(height / GRID_SIZE);
        if (heightInUnits % 2 !== 0 || heightInUnits === 0) continue;

        // Calculate angles of the two sides relative to horizontal
        const a1 = Math.atan2(testV3.y - pBase1.y, testV3.x - pBase1.x) * 180 / Math.PI;
        const a2 = Math.atan2(testV3.y - pBase2.y, testV3.x - pBase2.x) * 180 / Math.PI;
        
        const mod1 = Math.abs(a1 % 15);
        const err1 = Math.min(mod1, 15 - mod1);
        const mod2 = Math.abs(a2 % 15);
        const err2 = Math.min(mod2, 15 - mod2);
        
        // Weight the error: prefer points closer to original while favoring 15-degree multiples and exact even height
        const distFromOriginal = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
        const totalError = (err1 + err2) * 5 + distFromOriginal;
        
        if (totalError < minAngleError) {
          minAngleError = totalError;
          bestV3 = testV3;
        }
      }
    }
    vertices[bk] = bestV3;
    
    return vertices;
  };

  const rotatePoint = useCallback((p: Point, angle: number): Point => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
      y: p.x * Math.sin(rad) + p.y * Math.cos(rad)
    };
  }, []);

  const getGlobalPoints = useCallback((shape: Shape) => {
    return shape.points.map(p => {
      const rp = rotatePoint(p, shape.rotation);
      return { x: rp.x + shape.position.x, y: rp.y + shape.position.y };
    });
  }, [rotatePoint]);

  const attemptMerge = useCallback((activeShape: Shape, allShapes: Shape[]) => {
    const others = allShapes.filter(s => s.id !== activeShape.id);
    const g1 = getGlobalPoints(activeShape);

    for (const other of others) {
      const g2 = getGlobalPoints(other);
      const sharedIndices: [number, number][] = [];

      // Find vertex pairs that are close to each other
      for (let i = 0; i < g1.length; i++) {
        for (let j = 0; j < g2.length; j++) {
          const dist = Math.sqrt(Math.pow(g1[i].x - g2[j].x, 2) + Math.pow(g1[i].y - g2[j].y, 2));
          if (dist < 15) { // Tolerance for snapping
            sharedIndices.push([i, j]);
          }
        }
      }

      // If they share vertices, they might be adjacent
      if (sharedIndices.length >= 2) {
        // Find the length of the shared edge on both shapes
        const edge1Len = Math.sqrt(
          Math.pow(g1[sharedIndices[0][0]].x - g1[sharedIndices[1][0]].x, 2) +
          Math.pow(g1[sharedIndices[0][0]].y - g1[sharedIndices[1][0]].y, 2)
        );
        const edge2Len = Math.sqrt(
          Math.pow(g2[sharedIndices[0][1]].x - g2[sharedIndices[1][1]].x, 2) +
          Math.pow(g2[sharedIndices[0][1]].y - g2[sharedIndices[1][1]].y, 2)
        );

        // If edge lengths are significantly different, they won't form a clean shape
        if (Math.abs(edge1Len - edge2Len) > 10) {
          setToastMessage('길이가 맞지 않아요. 자 도구로 길이를 맞춰 다시 잘라볼까요? 📏');
          setShowSuccessToast(true);
          setTimeout(() => setShowSuccessToast(false), 3000);
          return false;
        }

        // Snap the active shape to match the other shape perfectly
        setShapes(prev => {
          const newShapes = prev.map(s => {
            if (s.id === activeShape.id) {
              const pA1 = g1[sharedIndices[0][0]];
              const pB1 = g2[sharedIndices[0][1]];
              const dx = pB1.x - pA1.x;
              const dy = pB1.y - pA1.y;
              return {
                ...s,
                position: { 
                  x: snapToGrid(s.position.x + dx), 
                  y: snapToGrid(s.position.y + dy) 
                }
              };
            }
            return s;
          });

          // Check if the combination forms a parallelogram (or just a nice joined polygon)
          // For simplicity, we just join them into a single polygon if they share an edge
          const s1 = newShapes.find(s => s.id === activeShape.id)!;
          const s2 = newShapes.find(s => s.id === other.id)!;
          
          return newShapes;
        });

        return true;
      }
    }
    return false;
  }, [getGlobalPoints, snapToGrid]);

  const executeCut = useCallback(() => {
    if (!cutLine) return;

    // Use selected shape if exists, otherwise find all intersecting shapes
    const targets = selectedId 
      ? shapes.filter(s => s.id === selectedId)
      : shapes.filter(s => {
          const gPoints = getGlobalPoints(s);
          const p1 = cutLine.start;
          const p2 = cutLine.end;
          
          const A = p1.y - p2.y;
          const B = p2.x - p1.x;
          const C = p1.x * p2.y - p2.x * p1.y;
          const side = (p: Point) => A * p.x + B * p.y + C;

          for (let i = 0; i < gPoints.length; i++) {
            const a = gPoints[i];
            const b = gPoints[(i + 1) % gPoints.length];
            const sA = side(a);
            const sB = side(b);
            if ((sA > 0.1 && sB < -0.1) || (sA < -0.1 && sB > 0.1)) return true;
          }
          return false;
        });

    if (targets.length === 0) {
      setToastMessage('가로지르는 도형이 없어요! 📐');
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 2000);
      return;
    }

    addToHistory();
    let finalShapes = [...shapes];
    let anyCut = false;

    targets.forEach(target => {
      const gPoints = getGlobalPoints(target);
      const p1 = cutLine.start;
      const p2 = cutLine.end;
      const A = p1.y - p2.y;
      const B = p2.x - p1.x;
      const C = p1.x * p2.y - p2.x * p1.y;
      const side = (p: Point) => A * p.x + B * p.y + C;

      const sideA: Point[] = [];
      const sideB: Point[] = [];

      for (let i = 0; i < gPoints.length; i++) {
        const a = gPoints[i];
        const b = gPoints[(i + 1) % gPoints.length];
        const sA = side(a);
        const sB = side(b);

        if (sA >= -0.1) sideA.push(a);
        if (sA <= 0.1) sideB.push(a);

        if ((sA > 0.1 && sB < -0.1) || (sA < -0.1 && sB > 0.1)) {
          const t = Math.abs(sA) / (Math.abs(sA) + Math.abs(sB));
          const intersect = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
          sideA.push(intersect);
          sideB.push(intersect);
        }
      }

      const filterUnique = (pts: Point[]) => {
        const result: Point[] = [];
        pts.forEach(p => {
          if (!result.find(rp => Math.abs(rp.x - p.x) < 0.1 && Math.abs(rp.y - p.y) < 0.1)) result.push(p);
        });
        if (result.length < 3) return [];
        const cx = result.reduce((acc, p) => acc + p.x, 0) / result.length;
        const cy = result.reduce((acc, p) => acc + p.y, 0) / result.length;
        return result.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
      };

      const uniqueA = filterUnique(sideA);
      const uniqueB = filterUnique(sideB);

      if (uniqueA.length >= 3 && uniqueB.length >= 3) {
        anyCut = true;
        const createShapeFromPoints = (points: Point[]) => {
          const cx = snapToGrid(points.reduce((acc, p) => acc + p.x, 0) / points.length);
          const cy = snapToGrid(points.reduce((acc, p) => acc + p.y, 0) / points.length);
          return {
            id: Math.random().toString(36).substr(2, 9),
            points: points.map(p => ({ x: p.x - cx, y: p.y - cy })),
            position: { x: cx, y: cy },
            rotation: 0,
            color: target.color,
            type: 'piece' as const
          };
        };
        const newPieces = [createShapeFromPoints(uniqueA), createShapeFromPoints(uniqueB)];
        finalShapes = finalShapes.filter(s => s.id !== target.id).concat(newPieces);
      }
    });

    if (anyCut) {
      setShapes(finalShapes);
      setSelectedId(null);
      setCutLine(null);
      setIsCutLineSelected(false);
      setToastMessage('도형이 잘렸어요! ✂️');
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 2000);
    }
  }, [cutLine, selectedId, shapes, snapToGrid, addToHistory, getGlobalPoints]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (mode === 'draw') {
      setIsDrawing(true);
      const newPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setDrawingPath([newPoint]);
      setSelectedId(null);
      setCutLine(null);
    } else if (mode === 'cut') {
      setIsDrawing(true);
      setIsCutLineSelected(false);
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setCutLine({ start: { x: snapToGrid(pos.x), y: snapToGrid(pos.y) }, end: { x: snapToGrid(pos.x), y: snapToGrid(pos.y) } });
    } else {
      setSelectedId(null);
      setIsCutLineSelected(false);
      if (mode !== 'cut') setCutLine(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (mouseDownPos && !hasStartedDragging) {
      const dist = Math.sqrt(Math.pow(currentPoint.x - mouseDownPos.x, 2) + Math.pow(currentPoint.y - mouseDownPos.y, 2));
      if (dist > 5) {
        setHasStartedDragging(true);
        addToHistory();
      }
      return;
    }

    if (isDrawing) {
      if (mode === 'draw') setDrawingPath(prev => [...prev, currentPoint]);
      if (mode === 'cut') setCutLine(prev => prev ? { ...prev, end: { x: snapToGrid(currentPoint.x), y: snapToGrid(currentPoint.y) } } : null);
    }

    if (hasStartedDragging && isDraggingRuler) {
      setRulerPos({
        x: currentPoint.x - rulerDragOffset.x,
        y: currentPoint.y - rulerDragOffset.y
      });
    }

    if (hasStartedDragging && draggingId && mode === 'select') {
      setShapes(prev => prev.map(t =>
        t.id === draggingId
          ? { ...t, position: { x: snapToGrid(currentPoint.x - dragOffset.x), y: snapToGrid(currentPoint.y - dragOffset.y) } }
          : t
      ));
    }
  };

  const handleMouseUp = () => {
    setMouseDownPos(null);
    setHasStartedDragging(false);

    if (isDrawing) {
      if (mode === 'draw') {
        const vertices = recognizeTriangle(drawingPath);
        if (vertices) {
          addToHistory();
          const cx = snapToGrid((vertices[0].x + vertices[1].x + vertices[2].x) / 3);
          const cy = snapToGrid((vertices[0].y + vertices[1].y + vertices[2].y) / 3);

          const relativePoints: Point[] = [
            { x: vertices[0].x - cx, y: vertices[0].y - cy },
            { x: vertices[1].x - cx, y: vertices[1].y - cy },
            { x: vertices[2].x - cx, y: vertices[2].y - cy },
          ];

          const newShape: Shape = {
            id: Math.random().toString(36).substr(2, 9),
            points: relativePoints,
            position: { x: cx, y: cy },
            rotation: 0,
            color: COLORS[shapes.length % COLORS.length],
            type: 'triangle'
          };
          setShapes(prev => [...prev, newShape]);
          setToastMessage('새로운 삼각형 완성! ✨');
          setShowSuccessToast(true);
          setTimeout(() => setShowSuccessToast(false), 2000);
        }
        setDrawingPath([]);
      }
      setIsDrawing(false);
    }

    if (isDraggingRuler) {
      setIsDraggingRuler(false);
      setRulerPos(prev => ({ x: snapToGrid(prev.x), y: snapToGrid(prev.y) }));
    }

    if (draggingId) {
      const activeShape = shapes.find(s => s.id === draggingId);
      if (activeShape) {
        attemptMerge(activeShape, shapes);
      }
    }

    setDraggingId(null);
  };

  const handleTriangleMouseDown = (e: React.MouseEvent, t: Shape) => {
    if (mode === 'select') {
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      const pos = { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };
      setMouseDownPos(pos);
      setHasStartedDragging(false);
      
      setSelectedId(t.id);
      setDraggingId(t.id);
      setDragOffset({
        x: pos.x - t.position.x,
        y: pos.y - t.position.y
      });
    }
  };

  const deleteSelected = useCallback(() => {
    if (selectedId) {
      addToHistory();
      setShapes(prev => prev.filter(t => t.id !== selectedId));
      setSelectedId(null);
    }
  }, [selectedId, addToHistory]);

  const rotateSelected = useCallback(() => {
    if (selectedId) {
      addToHistory();
      setShapes(prev => prev.map(t =>
        t.id === selectedId ? { ...t, rotation: (t.rotation + 15) % 360 } : t
      ));
    }
  }, [selectedId, addToHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Small step for fine control, larger step for grid snapping
      const step = e.shiftKey ? GRID_SIZE : 2;

      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'r' || e.key === 'R') {
        if (selectedId) rotateSelected();
        else if (showRuler) setRulerRot(prev => (prev + 15) % 360);
      }
      if (e.key === 'Enter') {
        if (cutLine) executeCut();
        else setSelectedId(null);
      }

      // Arrow keys for movement
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        if (selectedId) {
          setShapes(prev => prev.map(s => {
            if (s.id === selectedId) {
              return {
                ...s,
                position: { 
                  x: e.shiftKey ? snapToGrid(s.position.x + dx) : s.position.x + dx, 
                  y: e.shiftKey ? snapToGrid(s.position.y + dy) : s.position.y + dy 
                }
              };
            }
            return s;
          }));
        } else if (isCutLineSelected && cutLine) {
          setCutLine(prev => prev ? {
            start: {
              x: e.shiftKey ? snapToGrid(prev.start.x + dx) : prev.start.x + dx,
              y: e.shiftKey ? snapToGrid(prev.start.y + dy) : prev.start.y + dy
            },
            end: {
              x: e.shiftKey ? snapToGrid(prev.end.x + dx) : prev.end.x + dx,
              y: e.shiftKey ? snapToGrid(prev.end.y + dy) : prev.end.y + dy
            }
          } : null);
        } else if (showRuler) {
          setRulerPos(prev => ({
            x: e.shiftKey ? snapToGrid(prev.x + dx) : prev.x + dx,
            y: e.shiftKey ? snapToGrid(prev.y + dy) : prev.y + dy
          }));
        } else if (mode === 'cut' && cutLine) {
          setCutLine(prev => prev ? {
            start: {
              x: e.shiftKey ? snapToGrid(prev.start.x + dx) : prev.start.x + dx,
              y: e.shiftKey ? snapToGrid(prev.start.y + dy) : prev.start.y + dy
            },
            end: {
              x: e.shiftKey ? snapToGrid(prev.end.x + dx) : prev.end.x + dx,
              y: e.shiftKey ? snapToGrid(prev.end.y + dy) : prev.end.y + dy
            }
          } : null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, rotateSelected, mode, executeCut, selectedId, showRuler, snapToGrid, cutLine, isCutLineSelected]);

  return (
    <div className="flex flex-col h-screen select-none font-jua">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md p-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-200">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
              <path d="M12 4L4 20h16L12 4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">삼각형의 넓이 탐구</h1>
            <p className="text-xs text-slate-500 font-medium font-sans">활동 2: 잘라서 모양 만들기</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl">
          <button
            onClick={() => setMode('select')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
              mode === 'select' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500 hover:bg-white/50'
            }`}
          >
            <MousePointer2 className="w-4 h-4" />
            선택 & 이동
          </button>
          <button
            onClick={() => setMode('draw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
              mode === 'draw' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500 hover:bg-white/50'
            }`}
          >
            <Pencil className="w-4 h-4" />
            삼각형 그리기
          </button>
          <button
            onClick={() => {
              setMode('cut');
              if (shapes.length > 0 && !selectedId) {
                setToastMessage('자를 삼각형을 먼저 선택해주세요!');
                setShowSuccessToast(true);
                setTimeout(() => setShowSuccessToast(false), 2000);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
              mode === 'cut' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500 hover:bg-white/50'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2">
              <path d="M6 3L20 12L6 21M6 3L6 21" />
            </svg>
            자르기
          </button>
          <button
            onClick={() => setShowRuler(!showRuler)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
              showRuler ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500 hover:bg-white/50'
            }`}
          >
            <Ruler className="w-4 h-4" />
            자 도구
          </button>
        </div>

        <div className="flex items-center gap-2">
          {shapes.length > 0 && (
            <>
              <button
                onClick={() => undo()}
                disabled={history.length === 0}
                className={`p-2 rounded-xl transition-all ${
                  history.length === 0 
                  ? 'text-slate-300 cursor-not-allowed' 
                  : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="되돌리기 (Ctrl+Z)"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
              <button
                onClick={() => {
                  if (confirm('모든 도형을 삭제할까요?')) {
                    addToHistory();
                    setShapes([]);
                  }
                }}
                className="px-3 py-2 hover:bg-red-50 rounded-xl text-red-500 text-sm transition-all flex items-center gap-1"
              >
                <RotateCcw className="w-4 h-4" />
                모두 지우기
              </button>
            </>
          )}
          {selectedId && (
            <div className="flex items-center mr-2 pr-4 border-r border-slate-200 gap-2">
              <button
                onClick={rotateSelected}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-600 border border-slate-200 bg-white shadow-sm transition-transform active:scale-95"
                title="회전 (R)"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button
                onClick={deleteSelected}
                className="p-2 hover:bg-red-50 rounded-full text-red-500 border border-slate-200 bg-white shadow-sm transition-transform active:scale-95"
                title="삭제 (Del)"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-600 border border-slate-200 bg-white shadow-sm"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main
        ref={containerRef}
        className={`relative flex-1 grid-bg overflow-hidden transition-colors ${
          mode === 'draw' ? 'cursor-crosshair' : mode === 'cut' ? 'cursor-nwse-resize' : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Success Toast / Pop animation */}
        <AnimatePresence>
          {showSuccessToast && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2 } }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 backdrop-blur-md px-8 py-4 rounded-full shadow-2xl border-4 border-orange-400 z-50 flex items-center gap-3 pointer-events-none"
            >
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <Pencil className="w-6 h-6 text-orange-600" />
              </div>
              <span className="text-xl font-bold text-slate-800">{toastMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Visual Aids */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-20">
          {isDrawing && mode === 'draw' && drawingPath.length > 1 && (
            <polyline
              points={drawingPath.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#fb923c"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="10 10"
            />
          )}
          {cutLine && (
            <g className="cursor-pointer pointer-events-auto">
              {/* Hit area for easier selection */}
              <line
                x1={cutLine.start.x} y1={cutLine.start.y}
                x2={cutLine.end.x} y2={cutLine.end.y}
                stroke="transparent"
                strokeWidth="24"
                className="cursor-pointer"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsCutLineSelected(true);
                  setSelectedId(null);
                  setMode('cut');
                  setToastMessage('점선이 선택되었습니다. 📏');
                  setShowSuccessToast(true);
                  setTimeout(() => setShowSuccessToast(false), 1500);
                }}
                onMouseDown={(e) => {
                  if (mode === 'cut') e.stopPropagation();
                }}
              />
              <line
                x1={cutLine.start.x} y1={cutLine.start.y}
                x2={cutLine.end.x} y2={cutLine.end.y}
                stroke={isCutLineSelected ? "#2563eb" : "#ef4444"}
                strokeWidth={isCutLineSelected ? "6" : "4"}
                strokeDasharray="8 8"
                className="pointer-events-none"
              />
              {/* Selection handle indicators */}
              {isCutLineSelected && (
                <>
                  <circle cx={cutLine.start.x} cy={cutLine.start.y} r="6" fill="#2563eb" />
                  <circle cx={cutLine.end.x} cy={cutLine.end.y} r="6" fill="#2563eb" />
                </>
              )}
            </g>
          )}
        </svg>

        {/* Triangle Objects */}
        {shapes.map(t => (
          <motion.div
            key={t.id}
            initial={false}
            animate={{
              x: t.position.x,
              y: t.position.y,
              rotate: t.rotation,
            }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 25,
              rotate: { duration: 0.2 }
            }}
            className="absolute left-0 top-0 pointer-events-none"
            style={{
              transformOrigin: '0 0',
            }}
          >
            <div className="relative pointer-events-auto" style={{ width: 0, height: 0 }}>
              <svg
                className={`triangle-svg overflow-visible cursor-grab active:cursor-grabbing transition-all ${
                  selectedId === t.id ? 'opacity-100' : 'opacity-90'
                }`}
                width="800"
                height="800"
                viewBox="-400 -400 800 800"
                style={{ 
                  position: 'absolute', 
                  left: -400, 
                  top: -400,
                }}
                onMouseDown={(e) => handleTriangleMouseDown(e, t)}
              >
                <polygon
                  points={t.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill={t.color}
                  stroke={selectedId === t.id ? '#000000' : 'white'}
                  strokeWidth="3"
                  strokeLinejoin="round"
                  className="transition-all"
                  style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.15))' }}
                />

                {/* Selection Indicator / Anchor */}
                {selectedId === t.id && (
                  <circle
                    cx={t.points[0].x}
                    cy={t.points[0].y}
                    r="8"
                    fill="white"
                    stroke="#000000"
                    strokeWidth="3"
                  />
                )}
              </svg>
            </div>
          </motion.div>
        ))}

        {/* Ruler Tool */}
        <AnimatePresence>
          {showRuler && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, x: rulerPos.x, y: rulerPos.y, rotate: rulerRot }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute left-0 top-0 z-30 cursor-grab active:cursor-grabbing group"
              onMouseDown={(e) => {
                e.stopPropagation();
                const rect = containerRef.current?.getBoundingClientRect();
                const pos = { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };
                setMouseDownPos(pos);
                setHasStartedDragging(false);
                setIsDraggingRuler(true);
                setRulerDragOffset({
                  x: pos.x - rulerPos.x,
                  y: pos.y - rulerPos.y
                });
              }}
            >
              <div className="relative bg-amber-100/60 backdrop-blur-md border-2 border-amber-400 rounded-sm h-12 flex shadow-xl overflow-hidden" 
                   style={{ width: `${30 * 15}px`, height: '50px' }}> {/* 15cm ruler */}
                {/* CM Markings */}
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="absolute h-full border-l border-amber-500/50" style={{ left: `${i * 30}px` }}>
                    <div className="h-4 border-l-2 border-amber-600"></div>
                    <span className="text-[10px] mt-4 ml-1 text-amber-800 font-sans font-bold">{i}</span>
                    {i < 15 && (
                       <div className="absolute h-2 border-l border-amber-600/50 top-0" style={{ left: '15px' }}></div>
                    )}
                  </div>
                ))}
                <div className="absolute bottom-1 right-2 text-[8px] text-amber-900 uppercase font-bold tracking-widest opacity-30">1cm = 1grid</div>
              </div>
              
              {/* Rotate button on ruler */}
              <button
                className="absolute -right-10 top-1/2 -translate-y-1/2 bg-white border-2 border-amber-400 p-1.5 rounded-full shadow-lg text-amber-600 hover:scale-110 transition-transform"
                onClick={(e) => {
                  e.stopPropagation();
                  setRulerRot(prev => (prev + 15) % 360);
                }}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State / Guide */}
        {shapes.length === 0 && !isDrawing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/60 backdrop-blur-sm p-8 rounded-3xl border-4 border-dashed border-slate-300 text-center"
            >
              <Pencil className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-lg text-slate-400 font-medium whitespace-pre-wrap">
                상단의 '삼각형 그리기'를 눌러서{"\n"}삼각형을 마음껏 그려보세요!
              </p>
            </motion.div>
          </div>
        )}

        {/* floating UI guide */}
        <AnimatePresence>
          {showGuide && (
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="absolute bottom-6 left-6 w-80 bg-white rounded-3xl p-6 shadow-2xl z-20 border border-slate-100"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-orange-600">선생님의 팁 💡</h3>
                <button
                  onClick={() => setShowGuide(false)}
                  className="text-slate-400 hover:text-slate-600 font-sans"
                >
                  &times;
                </button>
              </div>
              <ul className="space-y-4 text-sm text-slate-600 leading-relaxed font-jua">
                <li className="flex gap-3">
                  <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center shrink-0 text-sm">1</span>
                  <span className="text-base">삼각형을 그린 후 <b className="text-slate-800">자르기 도구</b>로 점선을 긋고 <b className="text-orange-500">Enter</b>를 눌러주세요.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center shrink-0 text-sm">2</span>
                  <span className="text-base">잘려진 조각을 드래그해서 옮기고, <b className="text-slate-800">R 키</b>로 회전시켜 합쳐보세요.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center shrink-0 text-sm">3</span>
                  <span className="text-base">삼각형을 잘라서 <b className="text-orange-500">새로운 모양</b>으로 만들어보자!</span>
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer / Status */}
      <footer className="bg-white border-t border-slate-100 px-6 py-3 flex items-center justify-between text-xs text-slate-500 font-medium font-sans">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" /> 방향키: 도형·자·점선 이동
          </span>
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" /> Shift + 방향키: 칸 단위 이동
          </span>
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" /> Enter: 자르기 / 선택 해제
          </span>
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" /> 더블클릭: 점선 선택
          </span>
          <span className="flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> R키: 회전
          </span>
          <span className="flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Delete키: 삭제
          </span>
        </div>
        <div>
          5학년 수학 삼각형의 넓이 - {shapes.length}개의 도형 활성화됨
        </div>
      </footer>
    </div>
  );
}
