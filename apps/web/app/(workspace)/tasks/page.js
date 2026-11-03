"use client"

import { TaskBoard } from "../../../components/tasks/TaskBoard"

export default function TasksPage() {
  return (
    <div className="workspace tasks-page">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Tasks</h1>
        </div>
      </div>
      <TaskBoard />
    </div>
  )
}
