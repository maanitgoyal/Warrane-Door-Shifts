import Calendar from "@/components/Calender";

export default function Home() {
  return (
    <div>
      {/* Top Bar */}
      <div className="flex justify-between items-center px-6 py-4 border-b">
        <h1 className="text-xl font-bold">
          Warrane Door Shifts {new Date().getFullYear()}
        </h1>

        <button className="bg-black text-white px-4 py-2 rounded-lg">
          Login
        </button>
      </div>

      <Calendar />
    </div>
  );
}
