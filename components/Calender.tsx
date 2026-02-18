"use client";

import { useState } from "react";

const HOUR_HEIGHT = 30;

export default function Calendar() {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const weekDates = getWeekDates(selectedDate);
  const shifts = generateStaticShifts(selectedDate);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex gap-6">
        {/* LEFT SIDE CALENDAR */}
        <div className="hidden md:block w-64 bg-slate-900 border border-slate-800 rounded-2xl p-4 h-fit">
          <MiniCalendar
            selectedDate={selectedDate}
            onSelect={(date: Date) => setSelectedDate(date)}
          />
        </div>

        {/* RIGHT SIDE MAIN CONTENT */}
        <div className="flex-1">
          {/* Week Strip */}
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={() =>
                setSelectedDate(
                  new Date(
                    selectedDate.setDate(selectedDate.getDate() - 7)
                  )
                )
              }
              className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg"
            >
              ◀
            </button>

            <div className="flex gap-3">
              {weekDates.map((date, index) => {
                const isSelected =
                  date.toDateString() ===
                  selectedDate.toDateString();

                return (
                  <div
                    key={index}
                    onClick={() =>
                      setSelectedDate(new Date(date))
                    }
                    className={`cursor-pointer px-4 py-2 rounded-xl min-w-[80px] text-center transition ${
                      isSelected
                        ? "bg-white text-black"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <div className="text-xs">
                      {date.toLocaleDateString("en-US", {
                        weekday: "short",
                      })}
                    </div>
                    <div className="text-lg font-semibold">
                      {date.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() =>
                setSelectedDate(
                  new Date(
                    selectedDate.setDate(selectedDate.getDate() + 7)
                  )
                )
              }
              className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg"
            >
              ▶
            </button>
          </div>

          {/* Timeline */}
          <div className="relative rounded-2xl p-6 bg-slate-900 border border-slate-800 overflow-hidden">
            {shifts.map((shift, index) => {
              const height =
                (shift.end - shift.start) * HOUR_HEIGHT;
              const isSmall = height < 40;

              return (
                <div
                  key={index}
                  className={`absolute left-16 right-4 rounded-xl shadow-lg ${
                    shift.type === "staff"
                      ? "bg-indigo-600"
                      : shift.type === "resident"
                      ? "bg-emerald-600"
                      : "bg-purple-700"
                  }`}
                  style={{
                    top: `${shift.start * HOUR_HEIGHT}px`,
                    height: `${height}px`,
                    padding: isSmall
                      ? "4px 8px"
                      : "8px 12px",
                    fontSize: isSmall ? "10px" : "12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: isSmall
                      ? "center"
                      : "flex-start",
                  }}
                >
                  <div className="font-semibold leading-tight">
                    {shift.title}
                  </div>

                  {!isSmall && (
                    <div className="opacity-80 leading-tight">
                      {shift.label}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Time Labels */}
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute left-2 text-[10px] text-slate-500"
                style={{
                  top: `${hour * HOUR_HEIGHT}px`,
                }}
              >
                {formatHour(hour)}
              </div>
            ))}

            <div
              style={{
                height: `${24 * HOUR_HEIGHT}px`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- MINI CALENDAR ---------------- */

function MiniCalendar({
  selectedDate,
  onSelect,
}: any) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const daysInMonth = lastDay.getDate();
  const startOffset = firstDay.getDay();

  const cells = [];

  for (let i = 0; i < startOffset; i++) {
    cells.push(null);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }

  return (
    <div>
      <div className="text-center text-white font-semibold mb-4">
        {firstDay.toLocaleString("en-US", {
          month: "long",
        })}{" "}
        {year}
      </div>

      <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 mb-2">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((date, index) =>
          date ? (
            <div
              key={index}
              onClick={() => onSelect(date)}
              className={`cursor-pointer text-center p-2 rounded-lg text-sm ${
                date.toDateString() ===
                selectedDate.toDateString()
                  ? "bg-indigo-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {date.getDate()}
            </div>
          ) : (
            <div key={index} />
          )
        )}
      </div>
    </div>
  );
}

/* ---------------- SHIFT LOGIC ---------------- */

function generateStaticShifts(date: Date) {
  const day = date.getDay();
  const shifts: any[] = [];

  if (day >= 1 && day <= 3) {
    shifts.push(createShift("Tony Celis", 8, 13, "staff"));
    shifts.push(createShift("Tony Celis", 14, 18, "staff"));
  }

  if (day === 4 || day === 5) {
    shifts.push(createShift("Steve Vasquez", 8, 13, "staff"));
    shifts.push(createShift("Steve Vasquez", 14, 18, "staff"));
  }

  if (day >= 1 && day <= 5) {
    shifts.push(createShift("Noe", 7, 8, "staff"));
  }

  return shifts;
}

function createShift(
  title: string,
  start: number,
  end: number,
  type: string
) {
  return {
    title,
    start,
    end,
    type,
    label: `${formatHour(start)} - ${formatHour(end)}`,
  };
}

/* ---------------- HELPERS ---------------- */

function formatHour(hour: number) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}${ampm}`;
}

function getWeekDates(baseDate: Date) {
  const start = new Date(baseDate);
  start.setDate(baseDate.getDate() - baseDate.getDay());

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(new Date(d));
  }
  return dates;
}
